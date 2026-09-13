import { z } from "zod";
import {
  budgetQualifiedSchema,
  incubatorTierSchema,
  isoDateTimeSchema,
  leadTempSchema,
  operatorWarmthLevelSchema,
  programInterestSchema,
  programTrackSchema,
  uuidSchema,
  type LeadTemp,
  type ProgramInterest,
  type ProgramTrack,
} from "./enums";
import {
  EMPTY_EXTRACTED_SCORE_FACTS,
  extractedScoreFactsSchema,
} from "./signals";

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;
export const MS_PER_DAY = 86_400_000;

export const personScoreSchema = z.number().int().min(SCORE_MIN).max(SCORE_MAX);

export const SCORE_RECOMPUTE_QUEUE = "score.recompute";
export const SCORE_RECOMPUTE_DELAY_MS = 2_000;
export const SCORE_NIGHTLY_JOB_ID = "score-nightly";

export function scoreRecomputeJobId(personId: string): string {
  return `score-${personId}`;
}

export type ScoreJobEnqueuePlan = "add" | "replace" | "skip";

export function planScoreJobEnqueue(state: string | null): ScoreJobEnqueuePlan {
  if (state === null) {
    return "add";
  }
  if (state === "active" || state === "waiting-children") {
    return "skip";
  }
  return "replace";
}

export type ScoreJobHandle = {
  getState: () => Promise<string>;
  remove: () => Promise<void>;
};

export async function enqueueCoalescedScoreJob<TData>(input: {
  jobId: string;
  data: TData;
  delayMs: number;
  getJob: (id: string) => Promise<ScoreJobHandle | null | undefined>;
  add: (
    name: string,
    data: TData,
    opts: {
      delay: number;
      jobId: string;
      removeOnComplete: number;
      removeOnFail: number;
    },
  ) => Promise<unknown>;
}): Promise<void> {
  const existing = await input.getJob(input.jobId);
  const state = existing ? await existing.getState() : null;
  const plan = planScoreJobEnqueue(state);
  if (plan === "skip") {
    return;
  }
  if (plan === "replace" && existing) {
    await existing.remove();
  }
  await input.add("recompute", input.data, {
    delay: input.delayMs,
    jobId: input.jobId,
    removeOnComplete: 50,
    removeOnFail: 50,
  });
}

export const scoreTriggerSchema = z.enum([
  "inbound_email",
  "inbound_reply",
  "call_held",
  "meeting_held",
  "no_show",
  "form",
  "application",
  "manual_edit",
  "operator_temp",
  "stage_change",
  "nightly",
  "import",
  "dry_run",
]);
export type ScoreTrigger = z.infer<typeof scoreTriggerSchema>;
export const scoreRecomputeJobDataSchema = z.object({
  personId: uuidSchema,
  trigger: scoreTriggerSchema,
  computedBy: uuidSchema.nullable().optional(),
});
export type ScoreRecomputeJobData = z.infer<typeof scoreRecomputeJobDataSchema>;

export const conversationKindSchema = z.enum(["meeting", "call"]);
export type ConversationKind = z.infer<typeof conversationKindSchema>;

export const conversationEventSchema = z.object({
  at: z.number().int(),
  kind: conversationKindSchema,
});
export type ConversationEvent = z.infer<typeof conversationEventSchema>;

export const inboundReplyEventSchema = z.object({
  at: z.number().int(),
});
export type InboundReplyEvent = z.infer<typeof inboundReplyEventSchema>;

export const programFitSchema = z.enum(["yes", "no", "unknown"]);
export type ProgramFit = z.infer<typeof programFitSchema>;

export const operatorTempSchema = z
  .object({
    level: operatorWarmthLevelSchema,
    at: z.number().int(),
  })
  .nullable();
export type OperatorTemp = z.infer<typeof operatorTempSchema>;

export const scoreBucketHoldSchema = z.object({
  reason: z.literal("downward_hysteresis"),
  score: personScoreSchema,
  rawBucket: leadTempSchema,
  bucket: leadTempSchema,
  enterAt: z.number().int(),
  dropsBelow: z.number().int(),
  summary: z.string().min(1),
});

export const personScoreSnapshotInputsSchema = z.object({
  formulaVersion: z.string().min(1),
  asOf: z.number().int(),
  previousBucket: leadTempSchema.nullable(),
  budgetQualified: budgetQualifiedSchema,
  programTrack: programTrackSchema.nullable(),
  programInterest: programInterestSchema.nullable(),
  incubatorTier: incubatorTierSchema.nullable(),
  priceUsd: z.number().int().nonnegative().nullable(),
  applicationCompleted: z.boolean(),
  conversations: z.array(conversationEventSchema),
  inboundReplies: z.array(inboundReplyEventSchema),
  programFit: programFitSchema,
  extracted: extractedScoreFactsSchema,
  operatorTemp: operatorTempSchema,
  signalIds: z.array(uuidSchema),
});
export type PersonScoreSnapshotInputs = z.infer<
  typeof personScoreSnapshotInputsSchema
>;

export const scoreFactsSchema = z.object({
  budgetQualified: budgetQualifiedSchema,
  programTrack: programTrackSchema.nullable(),
  programInterest: programInterestSchema.nullable(),
  incubatorTier: incubatorTierSchema.nullable(),
  priceUsd: z.number().int().nonnegative().nullable(),
  applicationCompleted: z.boolean(),
  conversations: z.array(conversationEventSchema),
  inboundReplies: z.array(inboundReplyEventSchema),
  programFit: programFitSchema,
  previousBucket: leadTempSchema.nullable(),
  asOf: z.number().int(),
  extracted: extractedScoreFactsSchema.default(EMPTY_EXTRACTED_SCORE_FACTS),
  operatorTemp: operatorTempSchema.default(null),
});
export type ScoreFacts = z.input<typeof scoreFactsSchema>;

export const SCORE_COMPONENT_IDS = [
  "affordability",
  "conversations",
  "application",
  "replies",
  "qualification",
  "extracted",
  "operator",
] as const;
export const scoreComponentIdSchema = z.enum(SCORE_COMPONENT_IDS);
export type ScoreComponentId = z.infer<typeof scoreComponentIdSchema>;

export const scoreComponentSchema = z.object({
  id: scoreComponentIdSchema,
  max: z.number().int().nonnegative(),
  raw: z.number().int(),
  contribution: z.number().int(),
  reason: z.string().min(1),
});
export type ScoreComponent = z.infer<typeof scoreComponentSchema>;

export const personScoreSnapshotSchema = z.object({
  id: uuidSchema,
  personId: uuidSchema,
  formulaVersion: z.string().min(1),
  score: personScoreSchema,
  bucket: leadTempSchema,
  rawBucket: leadTempSchema,
  hold: scoreBucketHoldSchema.nullable(),
  asOf: isoDateTimeSchema,
  trigger: scoreTriggerSchema,
  components: z.array(scoreComponentSchema),
  inputs: personScoreSnapshotInputsSchema,
  computedAt: isoDateTimeSchema,
  computedBy: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PersonScoreSnapshot = z.infer<typeof personScoreSnapshotSchema>;

export const scoreCapAppliedSchema = z.enum([
  "unknown_budget",
  "not_qualified",
]);
export type ScoreCapApplied = z.infer<typeof scoreCapAppliedSchema>;

const bucketThresholdsSchema = z.object({
  lukewarm: z.number().int(),
  warm: z.number().int(),
  hot: z.number().int(),
});

export const scoreFormulaConfigSchema = z.object({
  version: z.string().min(1),
  weights: z.object({
    affordability: z.number().int().nonnegative(),
    conversations: z.number().int().nonnegative(),
    application: z.number().int().nonnegative(),
    replies: z.number().int().nonnegative(),
    qualification: z.number().int().nonnegative(),
  }),
  affordability: z.object({
    notQualified: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    lightUnpriced: z.number().int().nonnegative(),
    lightFull: z.number().int().nonnegative(),
    lightMid: z.number().int().nonnegative(),
    lightOutOfRange: z.number().int().nonnegative(),
    heavy: z.number().int().nonnegative(),
    lightFullAtOrBelowUsd: z.number().int().nonnegative(),
    outOfRangeAtOrAboveUsd: z.number().int().nonnegative(),
    defaultPriceUsd: z.object({
      tier_1: z.number().int().nullable(),
      tier_2: z.number().int().nullable(),
      tier_3: z.number().int().nullable(),
      tier_4: z.number().int().nullable(),
    }),
  }),
  conversations: z.object({
    pointsByCount: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    halfLifeDays: z.number().positive(),
    maxAgeDays: z.number().int().positive(),
  }),
  application: z.object({
    completed: z.number().int().nonnegative(),
    notCompleted: z.number().int().nonnegative(),
  }),
  replies: z.object({
    pointsByCount: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    halfLifeDays: z.number().positive(),
    maxAgeDays: z.number().int().positive(),
  }),
  qualification: z.object({
    fitYes: z.number().int().nonnegative(),
    fitNo: z.number().int().nonnegative(),
    interestMatch: z.number().int().nonnegative(),
    interestOther: z.number().int().nonnegative(),
    interestByTrack: z.object({
      incubator: programInterestSchema,
      capital_raising: programInterestSchema,
      recruitment: programInterestSchema,
      allocation: programInterestSchema,
    }),
  }),
  caps: z.object({
    unknownBudgetMaxScore: z.number().int().min(SCORE_MIN).max(SCORE_MAX),
    notQualifiedMaxScore: z.number().int().min(SCORE_MIN).max(SCORE_MAX),
  }),
  extracted: z.object({
    maxContribution: z.number().int().nonnegative(),
    statedProgramFee: z.number().int().nonnegative(),
    programFitYes: z.number().int().nonnegative(),
    timelineNow: z.number().int().nonnegative(),
    timelineThisQuarter: z.number().int().nonnegative(),
  }),
  operator: z.object({
    maxContribution: z.number().int().nonnegative(),
    minContribution: z.number().int().nonpositive(),
    pointsByLevel: z.object({
      skeptical: z.number().int(),
      watch: z.number().int(),
      pursue: z.number().int(),
      priority: z.number().int(),
    }),
    halfLifeDays: z.number().positive(),
    maxAgeDays: z.number().int().positive(),
  }),
  hysteresis: z.object({
    enter: bucketThresholdsSchema,
    exit: bucketThresholdsSchema,
  }),
});
export type ScoreFormulaConfig = z.infer<typeof scoreFormulaConfigSchema>;

export const SCORE_FORMULA_V1: ScoreFormulaConfig = {
  version: "2026-09-12.v1",
  weights: {
    affordability: 35,
    conversations: 25,
    application: 15,
    replies: 15,
    qualification: 10,
  },
  affordability: {
    notQualified: 0,
    unknown: 8,
    lightUnpriced: 22,
    lightFull: 35,
    lightMid: 12,
    lightOutOfRange: 0,
    heavy: 35,
    lightFullAtOrBelowUsd: 10_000,
    outOfRangeAtOrAboveUsd: 100_000,
    defaultPriceUsd: {
      tier_1: 5_000,
      tier_2: 10_000,
      tier_3: null,
      tier_4: 100_000,
    },
  },
  conversations: {
    pointsByCount: [0, 10, 18, 25],
    halfLifeDays: 21,
    maxAgeDays: 90,
  },
  application: {
    completed: 15,
    notCompleted: 0,
  },
  replies: {
    pointsByCount: [0, 6, 11, 15],
    halfLifeDays: 21,
    maxAgeDays: 90,
  },
  qualification: {
    fitYes: 10,
    fitNo: 0,
    interestMatch: 6,
    interestOther: 2,
    interestByTrack: {
      incubator: "hedge_fund_incubator",
      capital_raising: "lp_raising_program",
      recruitment: "quant_analyst_placement",
      allocation: "lp_raising_program",
    },
  },
  caps: {
    unknownBudgetMaxScore: 49,
    notQualifiedMaxScore: 24,
  },
  extracted: {
    maxContribution: 8,
    statedProgramFee: 5,
    programFitYes: 3,
    timelineNow: 2,
    timelineThisQuarter: 1,
  },
  operator: {
    maxContribution: 10,
    minContribution: -10,
    pointsByLevel: { skeptical: -6, watch: 3, pursue: 7, priority: 10 },
    halfLifeDays: 21,
    maxAgeDays: 90,
  },
  hysteresis: {
    enter: { lukewarm: 30, warm: 55, hot: 80 },
    exit: { lukewarm: 22, warm: 45, hot: 68 },
  },
};

export type ScoreBucketHold = z.infer<typeof scoreBucketHoldSchema>;

export type ScoreBreakdown = {
  score: number;
  uncappedScore: number;
  capApplied: ScoreCapApplied | null;
  bucket: LeadTemp;
  rawBucket: LeadTemp;
  hold: ScoreBucketHold | null;
  bucketChanged: boolean;
  previousBucket: LeadTemp | null;
  configVersion: string;
  components: ScoreComponent[];
};

export type CampaignScoreView = {
  score: number;
  bucket: LeadTemp;
  hold: ScoreBucketHold | null;
};

export function campaignScoreView(breakdown: ScoreBreakdown): CampaignScoreView {
  return {
    score: breakdown.score,
    bucket: breakdown.bucket,
    hold: breakdown.hold,
  };
}

/** Display mapping on the contact page. Campaign tags still use hysteresis. */
export const DISPLAY_BUCKET_ENTER = {
  lukewarm: 25,
  warm: 50,
  hot: 75,
} as const;

const BUCKET_RANK: Record<LeadTemp, number> = {
  cold: 0,
  lukewarm: 1,
  warm: 2,
  hot: 3,
};

export function displayScoreBucket(score: number): LeadTemp {
  if (score >= DISPLAY_BUCKET_ENTER.hot) {
    return "hot";
  }
  if (score >= DISPLAY_BUCKET_ENTER.warm) {
    return "warm";
  }
  if (score >= DISPLAY_BUCKET_ENTER.lukewarm) {
    return "lukewarm";
  }
  return "cold";
}

export function explainDisplayVsCampaign(input: {
  score: number;
  displayBucket: LeadTemp;
  campaignBucket: LeadTemp;
  hysteresis: ScoreFormulaConfig["hysteresis"];
}): string | null {
  if (input.displayBucket === input.campaignBucket) {
    return null;
  }
  if (BUCKET_RANK[input.displayBucket] > BUCKET_RANK[input.campaignBucket]) {
    const nextBucket = input.displayBucket;
    const enterAt =
      nextBucket === "cold" ? 0 : input.hysteresis.enter[nextBucket];
    return `This contact scores ${input.score} and displays as ${input.displayBucket}, but stays in the ${input.campaignBucket} campaign because they have not cleared the ${input.displayBucket} enter threshold (${enterAt}) since their last bucket change.`;
  }
  const currentCampaign = input.campaignBucket;
  const dropsBelow =
    currentCampaign === "cold" ? 0 : input.hysteresis.exit[currentCampaign];
  return `This contact scores ${input.score} and displays as ${input.displayBucket}, but stays in the ${input.campaignBucket} campaign until they drop below ${dropsBelow}.`;
}

export type InspectScoreView = {
  score: number;
  campaignBucket: LeadTemp;
  displayBucket: LeadTemp;
  explanation: string | null;
};

export function inspectScoreView(
  score: number,
  campaignBucket: LeadTemp,
  hysteresis: ScoreFormulaConfig["hysteresis"] = SCORE_FORMULA_V1.hysteresis,
): InspectScoreView {
  const displayBucket = displayScoreBucket(score);
  return {
    score,
    campaignBucket,
    displayBucket,
    explanation: explainDisplayVsCampaign({
      score,
      displayBucket,
      campaignBucket,
      hysteresis,
    }),
  };
}

/** Last hand-set campaign temp is recent if younger than conversation half-life. */
export const RECENT_HAND_MARK_DAYS = 21;
/**
 * Wider window for reading marks by hand. Does not move the 21-day
 * weights-wrong line: a 60-day rate is a different claim.
 */
export const CALIBRATION_HAND_MARK_DAYS = 60;
/** More than a quarter of recent hand marks disagreeing means the weights are wrong. */
export const WEIGHTS_WRONG_DISAGREE_RATE = 0.25;
/** Below this n the rate is noise, not a verdict. One-of-one cannot condemn. */
export const WEIGHTS_WRONG_MIN_RECENT_HAND_MARKS = 8;

export const HAND_MARK_SOURCES = ["dropdown", "import", "other"] as const;
export type HandMarkSource = (typeof HAND_MARK_SOURCES)[number];

export type HandMarkSourceCounts = Record<HandMarkSource, number>;

/** Import person.update always writes this after-shape; dropdown patches do not. */
const IMPORT_PERSON_AFTER_KEYS = [
  "title",
  "company",
  "location",
  "resumeUrl",
  "appliedAt",
  "notes",
  "leadTemp",
  "budgetQualified",
] as const;

export function emptyHandMarkSourceCounts(): HandMarkSourceCounts {
  return { dropdown: 0, import: 0, other: 0 };
}

export function classifyLeadTempWriteSource(input: {
  activityType: string;
  what: unknown;
  after: unknown;
  pairedImport?: boolean;
}): HandMarkSource {
  if (input.pairedImport || input.activityType === "import" || input.what === "import") {
    return "import";
  }
  if (looksLikeImportPersonAfter(input.after)) {
    return "import";
  }
  if (input.what === "person.update") {
    return "dropdown";
  }
  return "other";
}

function looksLikeImportPersonAfter(after: unknown): boolean {
  if (!after || typeof after !== "object" || Array.isArray(after)) {
    return false;
  }
  const keys = new Set(Object.keys(after));
  return IMPORT_PERSON_AFTER_KEYS.every((key) => keys.has(key));
}

/** Same-request import + person.update can differ by a millisecond in the dump. */
export const IMPORT_PAIR_WINDOW_MS = 2_000;

export function importsPairedWith(
  writeAtMs: number,
  importAtMs: readonly number[],
): boolean {
  return importAtMs.some(
    (at) => Math.abs(at - writeAtMs) <= IMPORT_PAIR_WINDOW_MS,
  );
}

export type HandMarkLineStanding = "dropdown" | "import_only" | "insufficient";

export function handMarkLineStanding(input: {
  dropdown: number;
  import: number;
}): HandMarkLineStanding {
  if (input.dropdown >= WEIGHTS_WRONG_MIN_RECENT_HAND_MARKS) {
    return "dropdown";
  }
  if (input.import >= WEIGHTS_WRONG_MIN_RECENT_HAND_MARKS) {
    return "import_only";
  }
  return "insufficient";
}

export function histogramReasonKey(reason: string): string {
  return reason.startsWith("count_") ? "has_events" : reason;
}

export type WeightDisagreementJudgment = {
  recentHandMarks: number;
  recentDisagreements: number;
  rate: number | null;
  insufficientRecentMarks: boolean;
  weightsWrong: boolean;
};

export function isRecentHandMark(days: number | null): boolean {
  return days !== null && days < RECENT_HAND_MARK_DAYS;
}

export function isCalibrationHandMark(days: number | null): boolean {
  return days !== null && days < CALIBRATION_HAND_MARK_DAYS;
}

export type ScoreComponentHistogramBin = {
  n: number;
  zeroRaw: number;
  firing: number;
  firingRate: number | null;
  sumContribution: number;
  meanContribution: number | null;
  maxContribution: number;
  reasons: Record<string, number>;
};

export type ScoreCapHistogram = {
  none: number;
  unknown_budget: number;
  not_qualified: number;
};

export type ScoreComponentHistogram = Record<
  ScoreComponentId,
  ScoreComponentHistogramBin
>;

function emptyComponentHistogramBin(): ScoreComponentHistogramBin {
  return {
    n: 0,
    zeroRaw: 0,
    firing: 0,
    firingRate: null,
    sumContribution: 0,
    meanContribution: null,
    maxContribution: 0,
    reasons: {},
  };
}

export function emptyScoreComponentHistogram(): ScoreComponentHistogram {
  return {
    affordability: emptyComponentHistogramBin(),
    conversations: emptyComponentHistogramBin(),
    application: emptyComponentHistogramBin(),
    replies: emptyComponentHistogramBin(),
    qualification: emptyComponentHistogramBin(),
    extracted: emptyComponentHistogramBin(),
    operator: emptyComponentHistogramBin(),
  };
}

export function summarizeScoreComponentHistogram(
  peopleComponents: readonly (readonly ScoreComponent[])[],
): ScoreComponentHistogram {
  const histogram = emptyScoreComponentHistogram();
  for (const components of peopleComponents) {
    for (const component of components) {
      const bin = histogram[component.id];
      bin.n += 1;
      if (component.raw === 0) {
        bin.zeroRaw += 1;
      }
      if (component.contribution > 0) {
        bin.firing += 1;
      }
      bin.sumContribution += component.contribution;
      if (component.contribution > bin.maxContribution) {
        bin.maxContribution = component.contribution;
      }
      const reason = histogramReasonKey(component.reason);
      bin.reasons[reason] = (bin.reasons[reason] ?? 0) + 1;
    }
  }
  for (const id of SCORE_COMPONENT_IDS) {
    const bin = histogram[id];
    bin.firingRate = bin.n === 0 ? null : bin.firing / bin.n;
    bin.meanContribution = bin.n === 0 ? null : bin.sumContribution / bin.n;
  }
  return histogram;
}

export function summarizeScoreCapHistogram(
  caps: readonly (ScoreCapApplied | null)[],
): ScoreCapHistogram {
  const histogram: ScoreCapHistogram = {
    none: 0,
    unknown_budget: 0,
    not_qualified: 0,
  };
  for (const cap of caps) {
    if (cap === null) {
      histogram.none += 1;
    } else {
      histogram[cap] += 1;
    }
  }
  return histogram;
}

/**
 * Verdict uses count of disagreements, not distance: one-rung and
 * cold↔hot are equal. Rises and drops both count; direction is
 * diagnostic on the dry-run report, not this boolean.
 */
export function judgeWeightDisagreement(input: {
  recentHandMarks: number;
  recentDisagreements: number;
}): WeightDisagreementJudgment {
  if (input.recentHandMarks <= 0) {
    return {
      recentHandMarks: 0,
      recentDisagreements: 0,
      rate: null,
      insufficientRecentMarks: true,
      weightsWrong: false,
    };
  }
  const rate = input.recentDisagreements / input.recentHandMarks;
  const insufficientRecentMarks =
    input.recentHandMarks < WEIGHTS_WRONG_MIN_RECENT_HAND_MARKS;
  return {
    recentHandMarks: input.recentHandMarks,
    recentDisagreements: input.recentDisagreements,
    rate,
    insufficientRecentMarks,
    weightsWrong:
      !insufficientRecentMarks && rate > WEIGHTS_WRONG_DISAGREE_RATE,
  };
}

export function scoreFactsFromSnapshotInputs(
  inputs: PersonScoreSnapshotInputs,
): ScoreFacts {
  return {
    budgetQualified: inputs.budgetQualified,
    programTrack: inputs.programTrack,
    programInterest: inputs.programInterest,
    incubatorTier: inputs.incubatorTier,
    priceUsd: inputs.priceUsd,
    applicationCompleted: inputs.applicationCompleted,
    conversations: inputs.conversations,
    inboundReplies: inputs.inboundReplies,
    programFit: inputs.programFit,
    previousBucket: inputs.previousBucket,
    asOf: inputs.asOf,
    extracted: inputs.extracted,
    operatorTemp: inputs.operatorTemp,
  };
}

export function replaySnapshotWithConfig(
  inputs: PersonScoreSnapshotInputs,
  config: ScoreFormulaConfig,
): ScoreBreakdown {
  return scoreContact(scoreFactsFromSnapshotInputs(inputs), config);
}

export const EMPTY_BUCKET_COUNTS: Record<LeadTemp, number> = {
  cold: 0,
  lukewarm: 0,
  warm: 0,
  hot: 0,
};

export function summarizeScoreReplay(
  rows: readonly { actualBucket: LeadTemp; replayedBucket: LeadTemp }[],
): {
  total: number;
  campaignChanges: number;
  before: Record<LeadTemp, number>;
  after: Record<LeadTemp, number>;
} {
  const before = { ...EMPTY_BUCKET_COUNTS };
  const after = { ...EMPTY_BUCKET_COUNTS };
  let campaignChanges = 0;
  for (const row of rows) {
    before[row.actualBucket] += 1;
    after[row.replayedBucket] += 1;
    if (row.actualBucket !== row.replayedBucket) {
      campaignChanges += 1;
    }
  }
  return { total: rows.length, campaignChanges, before, after };
}

export function operatorContribution(
  operatorTemp: OperatorTemp,
  asOf: number,
  config: ScoreFormulaConfig["operator"] = SCORE_FORMULA_V1.operator,
): { raw: number; contribution: number; daysOld: number; daysUntilExpiry: number } {
  if (!operatorTemp) {
    return { raw: 0, contribution: 0, daysOld: 0, daysUntilExpiry: 0 };
  }
  const raw = config.pointsByLevel[operatorTemp.level];
  const daysOld = Math.max(0, daysSince(operatorTemp.at, asOf));
  const factor = decayFactor(daysOld, config.halfLifeDays, config.maxAgeDays);
  const scaled = Math.round(raw * factor);
  const contribution = Math.min(
    config.maxContribution,
    Math.max(config.minContribution, scaled),
  );
  return {
    raw,
    contribution,
    daysOld,
    daysUntilExpiry: Math.max(0, config.maxAgeDays - daysOld),
  };
}

export function overrideAgainstComputed(
  operatorContributionValue: number,
  scoreWithoutOperator: number,
): boolean {
  if (operatorContributionValue === 0) {
    return false;
  }
  const rest = displayScoreBucket(scoreWithoutOperator);
  const restWarm = BUCKET_RANK[rest] >= BUCKET_RANK.warm;
  if (operatorContributionValue > 0) {
    return !restWarm;
  }
  return restWarm;
}

export function summarizeOverrideRollup(
  rows: readonly {
    contribution: number;
    daysOld: number;
    scoreWithoutOperator: number;
  }[],
): {
  activeCount: number;
  averageAgeDays: number;
  againstComputedCount: number;
  againstComputedRate: number;
} {
  const active = rows.filter((row) => row.contribution !== 0);
  const againstComputedCount = active.filter((row) =>
    overrideAgainstComputed(row.contribution, row.scoreWithoutOperator),
  ).length;
  const ageSum = active.reduce((sum, row) => sum + row.daysOld, 0);
  return {
    activeCount: active.length,
    averageAgeDays:
      active.length === 0 ? 0 : Math.round(ageSum / active.length),
    againstComputedCount,
    againstComputedRate:
      active.length === 0 ? 0 : againstComputedCount / active.length,
  };
}

export function nextScoreFormulaVersion(
  current: string,
  todayIsoDate: string,
): string {
  const match = /^(\d{4}-\d{2}-\d{2})\.v(\d+)$/.exec(current.trim());
  if (match && match[1] === todayIsoDate) {
    return `${todayIsoDate}.v${Number(match[2]) + 1}`;
  }
  return `${todayIsoDate}.v1`;
}

export function daysSince(at: number, asOf: number): number {
  return Math.floor((asOf - at) / MS_PER_DAY);
}

export function decayFactor(
  daysSinceValue: number,
  halfLifeDays: number,
  maxAgeDays: number,
): number {
  if (daysSinceValue >= maxAgeDays) {
    return 0;
  }
  if (daysSinceValue <= 0) {
    return 1;
  }
  return 0.5 ** (daysSinceValue / halfLifeDays);
}

export function rawEnterBucket(
  score: number,
  hysteresis: ScoreFormulaConfig["hysteresis"],
): LeadTemp {
  if (score >= hysteresis.enter.hot) {
    return "hot";
  }
  if (score >= hysteresis.enter.warm) {
    return "warm";
  }
  if (score >= hysteresis.enter.lukewarm) {
    return "lukewarm";
  }
  return "cold";
}

function exitFloor(
  bucket: LeadTemp,
  hysteresis: ScoreFormulaConfig["hysteresis"],
): number {
  if (bucket === "cold") {
    return Number.NEGATIVE_INFINITY;
  }
  return hysteresis.exit[bucket];
}

function enterAt(
  bucket: LeadTemp,
  hysteresis: ScoreFormulaConfig["hysteresis"],
): number | null {
  if (bucket === "cold") {
    return null;
  }
  return hysteresis.enter[bucket];
}

export function applyHysteresis(
  score: number,
  previousBucket: LeadTemp | null,
  hysteresis: ScoreFormulaConfig["hysteresis"],
): LeadTemp {
  const entered = rawEnterBucket(score, hysteresis);
  if (previousBucket === null) {
    return entered;
  }
  if (BUCKET_RANK[entered] > BUCKET_RANK[previousBucket]) {
    return entered;
  }
  if (score >= exitFloor(previousBucket, hysteresis)) {
    return previousBucket;
  }
  return entered;
}

export function bucketHold(
  score: number,
  rawBucket: LeadTemp,
  bucket: LeadTemp,
  hysteresis: ScoreFormulaConfig["hysteresis"],
): ScoreBucketHold | null {
  if (bucket === rawBucket || BUCKET_RANK[bucket] <= BUCKET_RANK[rawBucket]) {
    return null;
  }
  const enterThreshold = enterAt(bucket, hysteresis);
  const dropsBelow = exitFloor(bucket, hysteresis);
  if (enterThreshold === null) {
    return null;
  }
  return {
    reason: "downward_hysteresis",
    score,
    rawBucket,
    bucket,
    enterAt: enterThreshold,
    dropsBelow,
    summary: `${score} is below ${enterThreshold} to enter ${bucket}; campaign stays ${bucket} until below ${dropsBelow}`,
  };
}

function clampScore(value: number): number {
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(value)));
}

function pointsForCount(
  count: number,
  pointsByCount: readonly [number, number, number, number],
): number {
  const capped = Math.min(Math.max(count, 0), pointsByCount.length - 1);
  return pointsByCount[capped] ?? 0;
}

function latestAt(events: readonly { at: number }[]): number | null {
  let latest: number | null = null;
  for (const event of events) {
    if (latest === null || event.at > latest) {
      latest = event.at;
    }
  }
  return latest;
}

function decayedPoints(
  events: readonly { at: number }[],
  asOf: number,
  pointsByCount: readonly [number, number, number, number],
  halfLifeDays: number,
  maxAgeDays: number,
): { raw: number; contribution: number; daysSinceLatest: number | null } {
  const raw = pointsForCount(events.length, pointsByCount);
  const latest = latestAt(events);
  if (latest === null) {
    return { raw, contribution: 0, daysSinceLatest: null };
  }
  const elapsed = daysSince(latest, asOf);
  const factor = decayFactor(elapsed, halfLifeDays, maxAgeDays);
  return {
    raw,
    contribution: Math.round(raw * factor),
    daysSinceLatest: elapsed,
  };
}

function resolvedIncubatorPriceUsd(
  facts: ScoreFacts,
  config: ScoreFormulaConfig,
): number | null {
  if (facts.priceUsd !== null) {
    return facts.priceUsd;
  }
  if (facts.incubatorTier === null) {
    return null;
  }
  return config.affordability.defaultPriceUsd[facts.incubatorTier];
}

function affordabilityComponent(
  facts: ScoreFacts,
  config: ScoreFormulaConfig,
): ScoreComponent {
  const max = config.weights.affordability;
  const rules = config.affordability;

  if (facts.budgetQualified === "not_qualified") {
    return {
      id: "affordability",
      max,
      raw: rules.notQualified,
      contribution: rules.notQualified,
      reason: "not_qualified",
    };
  }
  if (facts.budgetQualified === "unknown") {
    return {
      id: "affordability",
      max,
      raw: rules.unknown,
      contribution: rules.unknown,
      reason: "unknown",
    };
  }
  if (facts.budgetQualified === "heavy") {
    return {
      id: "affordability",
      max,
      raw: rules.heavy,
      contribution: rules.heavy,
      reason: "heavy",
    };
  }

  if (facts.programTrack !== "incubator") {
    return {
      id: "affordability",
      max,
      raw: rules.lightUnpriced,
      contribution: rules.lightUnpriced,
      reason: "light_unpriced",
    };
  }

  const priceUsd = resolvedIncubatorPriceUsd(facts, config);
  if (priceUsd !== null && priceUsd <= rules.lightFullAtOrBelowUsd) {
    return {
      id: "affordability",
      max,
      raw: rules.lightFull,
      contribution: rules.lightFull,
      reason: "light_incubator_full",
    };
  }
  if (
    priceUsd !== null &&
    priceUsd >= rules.outOfRangeAtOrAboveUsd
  ) {
    return {
      id: "affordability",
      max,
      raw: rules.lightOutOfRange,
      contribution: rules.lightOutOfRange,
      reason: "light_incubator_out_of_range",
    };
  }
  if (facts.incubatorTier === "tier_4") {
    return {
      id: "affordability",
      max,
      raw: rules.lightOutOfRange,
      contribution: rules.lightOutOfRange,
      reason: "light_incubator_out_of_range",
    };
  }
  if (
    facts.incubatorTier === "tier_3" ||
    (priceUsd !== null && priceUsd > rules.lightFullAtOrBelowUsd)
  ) {
    return {
      id: "affordability",
      max,
      raw: rules.lightMid,
      contribution: rules.lightMid,
      reason: "light_incubator_mid",
    };
  }

  return {
    id: "affordability",
    max,
    raw: rules.lightUnpriced,
    contribution: rules.lightUnpriced,
    reason: "light_unpriced",
  };
}

function expectedInterestForTrack(
  track: ProgramTrack,
  config: ScoreFormulaConfig,
): ProgramInterest {
  return config.qualification.interestByTrack[track];
}

function qualificationComponent(
  facts: ScoreFacts,
  config: ScoreFormulaConfig,
): ScoreComponent {
  const max = config.weights.qualification;
  const rules = config.qualification;

  if (facts.programFit === "yes") {
    return {
      id: "qualification",
      max,
      raw: rules.fitYes,
      contribution: rules.fitYes,
      reason: "program_fit_yes",
    };
  }
  if (facts.programFit === "no") {
    return {
      id: "qualification",
      max,
      raw: rules.fitNo,
      contribution: rules.fitNo,
      reason: "program_fit_no",
    };
  }

  if (
    facts.programTrack !== null &&
    facts.programInterest !== null &&
    facts.programInterest !== "not_sure" &&
    facts.programInterest === expectedInterestForTrack(facts.programTrack, config)
  ) {
    return {
      id: "qualification",
      max,
      raw: rules.interestMatch,
      contribution: rules.interestMatch,
      reason: "interest_track_match",
    };
  }

  return {
    id: "qualification",
    max,
    raw: rules.interestOther,
    contribution: rules.interestOther,
    reason: "interest_track_other",
  };
}

function applyScoreCap(
  uncappedScore: number,
  budgetQualified: ScoreFacts["budgetQualified"],
  caps: ScoreFormulaConfig["caps"],
): { score: number; capApplied: ScoreCapApplied | null } {
  if (budgetQualified === "not_qualified") {
    const score = Math.min(uncappedScore, caps.notQualifiedMaxScore);
    return {
      score,
      capApplied: score < uncappedScore ? "not_qualified" : null,
    };
  }
  if (budgetQualified === "unknown") {
    const score = Math.min(uncappedScore, caps.unknownBudgetMaxScore);
    return {
      score,
      capApplied: score < uncappedScore ? "unknown_budget" : null,
    };
  }
  return { score: uncappedScore, capApplied: null };
}

function extractedComponent(
  facts: z.output<typeof scoreFactsSchema>,
  config: ScoreFormulaConfig,
): ScoreComponent {
  const rules = config.extracted;
  let raw = 0;
  const reasons: string[] = [];
  if (facts.extracted.statedProgramFee) {
    raw += rules.statedProgramFee;
    reasons.push("stated_program_fee");
  }
  if (facts.extracted.explicitProgramFit === "yes") {
    raw += rules.programFitYes;
    reasons.push("program_fit_yes");
  }
  if (facts.extracted.timeline === "now") {
    raw += rules.timelineNow;
    reasons.push("timeline_now");
  } else if (facts.extracted.timeline === "this_quarter") {
    raw += rules.timelineThisQuarter;
    reasons.push("timeline_this_quarter");
  }
  const contribution = Math.min(raw, rules.maxContribution);
  return {
    id: "extracted",
    max: rules.maxContribution,
    raw,
    contribution,
    reason:
      reasons.length === 0
        ? "none"
        : contribution < raw
          ? `${reasons.join("+")}_capped`
          : reasons.join("+"),
  };
}

function operatorComponent(
  facts: z.output<typeof scoreFactsSchema>,
  config: ScoreFormulaConfig,
): ScoreComponent {
  const rules = config.operator;
  if (facts.operatorTemp === null) {
    return {
      id: "operator",
      max: rules.maxContribution,
      raw: 0,
      contribution: 0,
      reason: "none",
    };
  }
  const raw = rules.pointsByLevel[facts.operatorTemp.level];
  const elapsed = daysSince(facts.operatorTemp.at, facts.asOf);
  const factor = decayFactor(elapsed, rules.halfLifeDays, rules.maxAgeDays);
  const scaled = Math.round(raw * factor);
  const contribution = Math.min(
    rules.maxContribution,
    Math.max(rules.minContribution, scaled),
  );
  return {
    id: "operator",
    max: rules.maxContribution,
    raw,
    contribution,
    reason: `level_${facts.operatorTemp.level}_decay_days_${elapsed}`,
  };
}

export function scoreContact(
  input: ScoreFacts,
  config: ScoreFormulaConfig = SCORE_FORMULA_V1,
): ScoreBreakdown {
  const facts = scoreFactsSchema.parse(input);
  const formula = scoreFormulaConfigSchema.parse(config);

  const conversations = decayedPoints(
    facts.conversations,
    facts.asOf,
    formula.conversations.pointsByCount,
    formula.conversations.halfLifeDays,
    formula.conversations.maxAgeDays,
  );
  const replies = decayedPoints(
    facts.inboundReplies,
    facts.asOf,
    formula.replies.pointsByCount,
    formula.replies.halfLifeDays,
    formula.replies.maxAgeDays,
  );
  const applicationRaw = facts.applicationCompleted
    ? formula.application.completed
    : formula.application.notCompleted;

  const components: ScoreComponent[] = [
    affordabilityComponent(facts, formula),
    {
      id: "conversations",
      max: formula.weights.conversations,
      raw: conversations.raw,
      contribution: conversations.contribution,
      reason:
        conversations.daysSinceLatest === null
          ? "no_conversations"
          : `count_${Math.min(facts.conversations.length, 3)}_decay_days_${conversations.daysSinceLatest}`,
    },
    {
      id: "application",
      max: formula.weights.application,
      raw: applicationRaw,
      contribution: applicationRaw,
      reason: facts.applicationCompleted ? "completed" : "not_completed",
    },
    {
      id: "replies",
      max: formula.weights.replies,
      raw: replies.raw,
      contribution: replies.contribution,
      reason:
        replies.daysSinceLatest === null
          ? "no_replies"
          : `count_${Math.min(facts.inboundReplies.length, 3)}_decay_days_${replies.daysSinceLatest}`,
    },
    qualificationComponent(facts, formula),
    extractedComponent(facts, formula),
    operatorComponent(facts, formula),
  ];

  const uncappedScore = clampScore(
    components.reduce((sum, component) => sum + component.contribution, 0),
  );
  const { score, capApplied } = applyScoreCap(
    uncappedScore,
    facts.budgetQualified,
    formula.caps,
  );
  const rawBucket = rawEnterBucket(score, formula.hysteresis);
  const bucket = applyHysteresis(
    score,
    facts.previousBucket,
    formula.hysteresis,
  );
  const hold = bucketHold(score, rawBucket, bucket, formula.hysteresis);

  return {
    score,
    uncappedScore,
    capApplied,
    bucket,
    rawBucket,
    hold,
    bucketChanged: facts.previousBucket !== bucket,
    previousBucket: facts.previousBucket,
    configVersion: formula.version,
    components,
  };
}

export type PlanScoreRecomputeInput = {
  score: number;
  formulaVersion: string;
  previousBucket?: LeadTemp | null;
};

export type PlanScoreRecomputeResult = {
  insertSnapshot: true;
  mutateExisting: false;
  score: number;
  bucket: LeadTemp;
};

export function planScoreRecompute(
  input: PlanScoreRecomputeInput,
): PlanScoreRecomputeResult {
  const parsed = personScoreSchema.parse(input.score);
  return {
    insertSnapshot: true,
    mutateExisting: false,
    score: parsed,
    bucket: applyHysteresis(
      parsed,
      input.previousBucket ?? null,
      SCORE_FORMULA_V1.hysteresis,
    ),
  };
}

export const SCORE_SKIP_SUPPRESSION_REASONS = [
  "unsubscribed",
  "complained",
  "hard_bounced",
  "do_not_contact",
] as const;

export function shouldSkipScore(reason: string | null): boolean {
  return (
    reason !== null &&
    (SCORE_SKIP_SUPPRESSION_REASONS as readonly string[]).includes(reason)
  );
}

export type LatestScoreSnapshot = {
  id: string;
  score: number;
  bucket: LeadTemp;
  rawBucket: LeadTemp;
  trigger: ScoreTrigger;
};

export type PlanScorePersistResult =
  | { action: "skip_suppressed" }
  | { action: "insert" }
  | { action: "touch"; snapshotId: string };

export function planScorePersist(input: {
  suppressed: boolean;
  latest: LatestScoreSnapshot | null;
  breakdown: Pick<ScoreBreakdown, "score" | "bucket" | "rawBucket">;
}): PlanScorePersistResult {
  if (input.suppressed) {
    return { action: "skip_suppressed" };
  }
  if (!input.latest) {
    return { action: "insert" };
  }
  if (
    input.latest.score === input.breakdown.score &&
    input.latest.bucket === input.breakdown.bucket &&
    input.latest.rawBucket === input.breakdown.rawBucket
  ) {
    return { action: "touch", snapshotId: input.latest.id };
  }
  return { action: "insert" };
}

export const NIGHTLY_DRIFT_SCORE_DELTA = 5;

export function planNightlyDrift(input: {
  latest: LatestScoreSnapshot | null;
  nightly: Pick<ScoreBreakdown, "score" | "bucket">;
}): { flag: boolean } {
  if (!input.latest || input.latest.trigger === "nightly") {
    return { flag: false };
  }
  const scoreDelta = Math.abs(input.nightly.score - input.latest.score);
  return {
    flag:
      input.latest.bucket !== input.nightly.bucket ||
      scoreDelta >= NIGHTLY_DRIFT_SCORE_DELTA,
  };
}

export const ENGINE_OWNS_LEAD_TEMP = "ENGINE_OWNS_LEAD_TEMP";
export const ENGINE_OWNS_LEAD_TEMP_MESSAGE =
  "Campaign temp is scored automatically. Use operator judgment to push a lead up or down.";

export function planLeadTempPatch(hasSnapshot: boolean): {
  reject: boolean;
  status: 409;
  code: typeof ENGINE_OWNS_LEAD_TEMP;
  message: typeof ENGINE_OWNS_LEAD_TEMP_MESSAGE;
} | { reject: false } {
  if (hasSnapshot) {
    return {
      reject: true,
      status: 409,
      code: ENGINE_OWNS_LEAD_TEMP,
      message: ENGINE_OWNS_LEAD_TEMP_MESSAGE,
    };
  }
  return { reject: false };
}
