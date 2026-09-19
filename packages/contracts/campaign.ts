import { z } from "zod";
import {
  isEligibleForNewsletter,
  isEligibleForSalesCampaign,
} from "./suppression";
import {
  isoDateTimeSchema,
  leadTempSchema,
  uuidSchema,
  type ContactKind,
  type LeadTemp,
  type ProgramTrack,
  type SuppressionReason,
} from "./enums";
import { MS_PER_DAY } from "./scoring";

export const CAMPAIGN_TAG_VERSION = "v1";
export const CAMPAIGN_TAG_PREFIX = "rl";
/** Rolling window for counting program/stage sequence starts. */
export const CAMPAIGN_PROGRAM_STAGE_CHURN_WINDOW_DAYS = 7;
export const CAMPAIGN_PROGRAM_STAGE_CHURN_WINDOW_MS =
  CAMPAIGN_PROGRAM_STAGE_CHURN_WINDOW_DAYS * MS_PER_DAY;
/**
 * Allow this many program/stage starts inside the window. The third
 * opening in a week is the churn case; one legitimate progression starts.
 */
export const CAMPAIGN_PROGRAM_STAGE_START_LIMIT = 2;

export const campaignLaneSchema = z.enum(["sales", "newsletter"]);
export type CampaignLane = z.infer<typeof campaignLaneSchema>;

export const campaignProgramTokenSchema = z.enum([
  "allocation",
  "incubator",
  "recruitment",
  "capital_raising",
  "unknown",
  "none",
]);
export type CampaignProgramToken = z.infer<typeof campaignProgramTokenSchema>;

export const campaignIntensitySchema = z.enum([
  "none",
  "soft",
  "cold",
  "lukewarm",
  "warm",
  "hot",
]);
export type CampaignIntensity = z.infer<typeof campaignIntensitySchema>;

export const campaignSequenceActionSchema = z.enum([
  "start",
  "stop",
  "hold",
  "pending_review",
]);
export type CampaignSequenceAction = z.infer<
  typeof campaignSequenceActionSchema
>;

/**
 * Rank is the only aggressiveness signal. Edit this table to change which
 * intensity is "higher". Moves read CAMPAIGN_MOVE_POLICY, not scattered ifs.
 */
export const CAMPAIGN_INTENSITY_RANK: Record<CampaignIntensity, number> = {
  none: -1,
  soft: 0,
  cold: 1,
  lukewarm: 2,
  warm: 3,
  hot: 4,
};

/**
 * Up a tier starts the more aggressive sequence. Down does not restart
 * the softer one — it only stops pushing.
 */
export const CAMPAIGN_MOVE_POLICY = {
  up: "start",
  down: "stop",
  same: "hold",
} as const satisfies Record<"up" | "down" | "same", CampaignSequenceAction>;

export const CAMPAIGN_REVIEW_INTENSITY = "hot" satisfies CampaignIntensity;

const SALES_CLOSED_STAGES = new Set([
  "passed",
  "allocated",
  "approved",
  "rejected",
]);

export type CampaignTagParts = {
  version: typeof CAMPAIGN_TAG_VERSION;
  lane: CampaignLane;
  program: CampaignProgramToken;
  stage: string;
  intensity: CampaignIntensity;
};

export function formatCampaignTag(parts: Omit<CampaignTagParts, "version">): string {
  return [
    CAMPAIGN_TAG_PREFIX,
    CAMPAIGN_TAG_VERSION,
    parts.lane,
    parts.program,
    parts.stage,
    parts.intensity,
  ].join(".");
}

export function parseCampaignTag(tag: string): CampaignTagParts | null {
  const pieces = tag.split(".");
  if (pieces.length !== 6) {
    return null;
  }
  const [prefix, version, laneRaw, programRaw, stage, intensityRaw] = pieces;
  if (
    prefix !== CAMPAIGN_TAG_PREFIX ||
    version !== CAMPAIGN_TAG_VERSION ||
    !stage
  ) {
    return null;
  }
  const lane = campaignLaneSchema.safeParse(laneRaw);
  const program = campaignProgramTokenSchema.safeParse(programRaw);
  const intensity = campaignIntensitySchema.safeParse(intensityRaw);
  if (!lane.success || !program.success || !intensity.success) {
    return null;
  }
  return {
    version: CAMPAIGN_TAG_VERSION,
    lane: lane.data,
    program: program.data,
    stage,
    intensity: intensity.data,
  };
}

export function campaignProgramStageKey(
  program: CampaignProgramToken,
  stage: string,
): string {
  return `${program}:${stage}`;
}

export type ResolveCampaignTagInput = {
  /** Hysteresis campaign bucket only. Never rawBucket or a display remap. */
  bucket: LeadTemp;
  programTrack: ProgramTrack | null;
  stage: string | null;
  suppressionReason: SuppressionReason | null;
  stayInTouch: boolean;
  doNotContact: boolean;
  newsletterGranted: boolean;
  contactKind?: ContactKind;
};

export type ResolvedCampaignTag = {
  tag: string;
  lane: CampaignLane;
  program: CampaignProgramToken;
  stage: string;
  intensity: CampaignIntensity;
  sequenceId: string;
};

export function resolveCampaignTag(
  input: ResolveCampaignTagInput,
): ResolvedCampaignTag | null {
  if (input.doNotContact || input.contactKind === "recruiter") {
    return null;
  }

  const newsletter = (): ResolvedCampaignTag | null => {
    if (
      !isEligibleForNewsletter({
        suppressionReason: input.suppressionReason,
        newsletterGranted: input.newsletterGranted,
      })
    ) {
      return null;
    }
    const parts = {
      lane: "newsletter" as const,
      program: "none" as const,
      stage: "none",
      intensity: "none" as const,
    };
    const tag = formatCampaignTag(parts);
    return { tag, sequenceId: tag, ...parts };
  };

  const salesOk = isEligibleForSalesCampaign({
    suppressionReason: input.suppressionReason,
    stayInTouch: input.stayInTouch,
    doNotContact: input.doNotContact,
  });

  if (!salesOk) {
    return newsletter();
  }

  const stage = input.stage?.trim() || "none";
  if (SALES_CLOSED_STAGES.has(stage)) {
    return newsletter();
  }

  if (!input.programTrack) {
    const parts = {
      lane: "sales" as const,
      program: "unknown" as const,
      stage: "none",
      intensity: "soft" as const,
    };
    const tag = formatCampaignTag(parts);
    return { tag, sequenceId: tag, ...parts };
  }

  const parts = {
    lane: "sales" as const,
    program: input.programTrack,
    stage,
    intensity: input.bucket,
  };
  const tag = formatCampaignTag(parts);
  return { tag, sequenceId: tag, ...parts };
}

export type CampaignMoveKind = "up" | "down" | "same";

export function campaignMoveKind(
  fromIntensity: CampaignIntensity | null,
  toIntensity: CampaignIntensity,
): CampaignMoveKind {
  const fromRank = fromIntensity
    ? CAMPAIGN_INTENSITY_RANK[fromIntensity]
    : Number.NEGATIVE_INFINITY;
  const toRank = CAMPAIGN_INTENSITY_RANK[toIntensity];
  if (toRank > fromRank) {
    return "up";
  }
  if (toRank < fromRank) {
    return "down";
  }
  return "same";
}

export type CampaignSequenceMemory = {
  tag: string | null;
  intensity: CampaignIntensity | null;
  programStageKey: string | null;
  lastSequenceStartAt: number | null;
  lastStartProgramStageKey: string | null;
  programStageStartCount: number;
  programStageStartWindowAt: number | null;
};

export type PlanCampaignSequenceInput = {
  previous: CampaignSequenceMemory | null;
  next: ResolvedCampaignTag | null;
  asOf: number;
  churnWindowMs?: number;
  programStageStartLimit?: number;
};

export type PlanCampaignSequenceResult = {
  tag: string | null;
  sequenceId: string | null;
  action: CampaignSequenceAction | null;
  intensity: CampaignIntensity | null;
  programStageKey: string | null;
  lastSequenceStartAt: number | null;
  lastStartProgramStageKey: string | null;
  programStageStartCount: number;
  programStageStartWindowAt: number | null;
  programStageChurnHeld: boolean;
  needsReview: boolean;
};

function programStageWindowState(
  previous: CampaignSequenceMemory | null,
  asOf: number,
  windowMs: number,
): { count: number; windowAt: number | null } {
  const count = previous?.programStageStartCount ?? 0;
  const windowAt = previous?.programStageStartWindowAt ?? null;
  if (windowAt === null || asOf - windowAt >= windowMs) {
    return { count: 0, windowAt: null };
  }
  return { count, windowAt };
}

export function planCampaignSequence(
  input: PlanCampaignSequenceInput,
): PlanCampaignSequenceResult {
  const churnWindowMs =
    input.churnWindowMs ?? CAMPAIGN_PROGRAM_STAGE_CHURN_WINDOW_MS;
  const startLimit =
    input.programStageStartLimit ?? CAMPAIGN_PROGRAM_STAGE_START_LIMIT;
  const previous = input.previous;
  const next = input.next;
  const window = programStageWindowState(previous, input.asOf, churnWindowMs);

  if (!next) {
    return {
      tag: null,
      sequenceId: null,
      action: previous?.tag ? "stop" : null,
      intensity: null,
      programStageKey: null,
      lastSequenceStartAt: previous?.lastSequenceStartAt ?? null,
      lastStartProgramStageKey: previous?.lastStartProgramStageKey ?? null,
      programStageStartCount: window.count,
      programStageStartWindowAt: window.windowAt,
      programStageChurnHeld: false,
      needsReview: false,
    };
  }

  const programStageKey = campaignProgramStageKey(next.program, next.stage);
  if (previous?.tag === next.tag) {
    return {
      tag: next.tag,
      sequenceId: next.sequenceId,
      action: CAMPAIGN_MOVE_POLICY.same,
      intensity: next.intensity,
      programStageKey,
      lastSequenceStartAt: previous.lastSequenceStartAt,
      lastStartProgramStageKey: previous.lastStartProgramStageKey,
      programStageStartCount: window.count,
      programStageStartWindowAt: window.windowAt,
      programStageChurnHeld: false,
      needsReview: false,
    };
  }

  const move = campaignMoveKind(previous?.intensity ?? null, next.intensity);
  const programStageChanged =
    previous?.programStageKey != null &&
    previous.programStageKey !== programStageKey;
  const lastStartAt = previous?.lastSequenceStartAt ?? null;

  let action: CampaignSequenceAction;
  let programStageChurnHeld = false;
  let programStageStartCount = window.count;
  let programStageStartWindowAt = window.windowAt;
  if (move === "down") {
    action = CAMPAIGN_MOVE_POLICY.down;
  } else if (move === "up") {
    action = CAMPAIGN_MOVE_POLICY.up;
  } else if (programStageChanged) {
    const count = window.windowAt === null ? 0 : window.count;
    if (count >= startLimit) {
      action = CAMPAIGN_MOVE_POLICY.same;
      programStageChurnHeld = true;
    } else {
      action = CAMPAIGN_MOVE_POLICY.up;
      programStageStartWindowAt = window.windowAt ?? input.asOf;
      programStageStartCount = count + 1;
    }
  } else {
    action = CAMPAIGN_MOVE_POLICY.same;
  }

  let needsReview = false;
  if (
    action === "start" &&
    next.intensity === CAMPAIGN_REVIEW_INTENSITY
  ) {
    action = "pending_review";
    needsReview = true;
  }

  const started = action === "start";
  return {
    tag: next.tag,
    sequenceId: next.sequenceId,
    action,
    intensity: next.intensity,
    programStageKey,
    lastSequenceStartAt: started ? input.asOf : lastStartAt,
    lastStartProgramStageKey: started
      ? programStageKey
      : (previous?.lastStartProgramStageKey ?? null),
    programStageStartCount,
    programStageStartWindowAt,
    programStageChurnHeld,
    needsReview,
  };
}

export const campaignTagPayloadSchema = z.object({
  schemaVersion: z.literal(CAMPAIGN_TAG_VERSION),
  personId: uuidSchema,
  email: z.string().min(1),
  tag: z.string().nullable(),
  previousTag: z.string().nullable(),
  sequenceId: z.string().nullable(),
  sequenceAction: campaignSequenceActionSchema.nullable(),
  lane: campaignLaneSchema.nullable(),
  program: campaignProgramTokenSchema.nullable(),
  stage: z.string().nullable(),
  intensity: campaignIntensitySchema.nullable(),
  bucket: leadTempSchema.nullable(),
  revision: z.number().int().nonnegative(),
  computedAt: isoDateTimeSchema,
  asOf: isoDateTimeSchema,
});
export type CampaignTagPayload = z.infer<typeof campaignTagPayloadSchema>;

export const campaignTagListQuerySchema = z.object({
  sinceRevision: z.coerce.number().int().nonnegative().optional(),
});
export type CampaignTagListQuery = z.infer<typeof campaignTagListQuerySchema>;

export const campaignTagListResponseSchema = z.object({
  schemaVersion: z.literal(CAMPAIGN_TAG_VERSION),
  asOf: isoDateTimeSchema,
  maxRevision: z.number().int().nonnegative(),
  data: z.array(campaignTagPayloadSchema),
});
export type CampaignTagListResponse = z.infer<
  typeof campaignTagListResponseSchema
>;

export const campaignSendPurposeSchema = z.enum([
  "sales",
  "newsletter",
  "value_add",
]);
export type CampaignSendPurpose = z.infer<typeof campaignSendPurposeSchema>;

export const outboundSendBodySchema = z.object({
  to: z.string().min(1),
  purpose: campaignSendPurposeSchema,
  subject: z.string().min(1),
  bodyText: z.string().min(1),
  tag: z.string().nullable().optional(),
  personId: uuidSchema.optional(),
});
export type OutboundSendBody = z.infer<typeof outboundSendBodySchema>;

export const outboundSendStatusSchema = z.enum([
  "queued",
  "blocked",
  "sending",
  "sent",
]);
export type OutboundSendStatus = z.infer<typeof outboundSendStatusSchema>;

export const outboundSendResponseSchema = z.object({
  id: uuidSchema,
  status: z.literal("queued"),
});
export type OutboundSendResponse = z.infer<typeof outboundSendResponseSchema>;

export const campaignTagReleaseParamsSchema = z.object({
  personId: uuidSchema,
});
export type CampaignTagReleaseParams = z.infer<
  typeof campaignTagReleaseParamsSchema
>;

export function staleCampaignPayload(
  incomingRevision: number,
  storedRevision: number,
): boolean {
  return incomingRevision < storedRevision;
}

export function staleCampaignAsOf(
  incomingAsOf: number,
  storedAsOf: number,
): boolean {
  return incomingAsOf < storedAsOf;
}

export function programTokenFromTrack(
  track: ProgramTrack | null,
): CampaignProgramToken {
  return track ?? "unknown";
}
