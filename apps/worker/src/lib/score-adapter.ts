import {
  canonicalEmail,
  emailMessageDirection,
  foldExtractedSignals,
  classifyLeadTempWriteSource,
  emptyHandMarkSourceCounts,
  handMarkLineStanding,
  importsPairedWith,
  isCalibrationHandMark,
  isRecentHandMark,
  judgeWeightDisagreement,
  summarizeScoreCapHistogram,
  summarizeScoreComponentHistogram,
  mailboxEmails,
  meetingHeldForScore,
  MS_PER_DAY,
  personScoreSnapshotInputsSchema,
  planNightlyDrift,
  planScorePersist,
  programFitSignalValueSchema,
  scoreContact,
  scoreTriggerSchema,
  shouldSkipScore,
  suppressionReasonSchema,
  uniqueEmails,
  warmthSignalValueSchema,
  type ExtractedSignal,
  type HandMarkLineStanding,
  type HandMarkSource,
  type HandMarkSourceCounts,
  type LeadTemp,
  type MeetingOutcome,
  type PersonScoreSnapshotInputs,
  type ScoreBreakdown,
  type ScoreCapApplied,
  type ScoreCapHistogram,
  type ScoreComponent,
  type ScoreComponentHistogram,
  type ScoreFacts,
  type ScoreFormulaConfig,
  type ScoreTrigger,
  type SuppressionReason,
} from "@realm-labs/contracts";
import {
  activities,
  emailMessages,
  emailSuppressions,
  emailThreads,
  findPersonByEmail,
  hmacSha256Hex,
  incubatorCards,
  listAlternateEmailsByPerson,
  meetings,
  people,
  personScoreSnapshots,
  personSignals,
  tasks,
  type Database,
} from "@realm-labs/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { writeActivity } from "./activity.js";
import { persistCampaignTag } from "./campaign-tag.js";
import { loadActiveScoreFormula } from "./score-formula.js";

export type ScoreAdapterEnv = {
  EMAIL_HASH_KEY: string;
  CAMPAIGN_TAG_WEBHOOK_URL?: string;
  CAMPAIGN_TAG_WEBHOOK_SECRET?: string;
};

export type ScoreRunMode = "dry" | "commit";

export type ScoreDryRunRow = {
  personId: string;
  email: string;
  manualBucket: LeadTemp | null;
  engineBucket: LeadTemp;
  score: number;
  holdSummary: string | null;
  createdAt: string;
  updatedAt: string;
  manualAt: string | null;
  manualAgeDays: number | null;
  /** Stored lead_temp is already the engine bucket; not a hand mark. */
  engineOwnsLeadTemp: boolean;
  handMarkSource: HandMarkSource | null;
};

export type ScoreDryRunDropAge = {
  recentUnder21d: number;
  mid: number;
  oldOver90d: number;
  unknown: number;
};

export type ScoreDryRunReport = {
  asOf: string;
  total: number;
  nullManual: number;
  hysteresisSeeds: number;
  byBucket: Record<LeadTemp, number>;
  drops: number;
  dropAge: ScoreDryRunDropAge;
  rises: number;
  disagreements: ScoreDryRunRow[];
  recentHandMarks: number;
  recentDisagreements: number;
  recentDrops: number;
  recentRises: number;
  recentDisagreeRate: number | null;
  insufficientRecentMarks: boolean;
  weightsWrong: boolean;
  recentBySource: HandMarkSourceCounts;
  calibrationHandMarks: number;
  calibrationDisagreements: number;
  calibrationDisagreeRate: number | null;
  calibrationBySource: HandMarkSourceCounts;
  handRead: ScoreDryRunRow[];
  components: ScoreComponentHistogram;
  caps: ScoreCapHistogram;
  skipped: number;
};

export type HandMarkSample = {
  personId: string;
  email: string;
  leadTemp: LeadTemp | null;
  source: HandMarkSource;
  at: string;
  ageDays: number | null;
};

export type HandMarkCountReport = {
  asOf: string;
  people: number;
  withStoredTemp: number;
  datedWrites: number;
  engineOwned: number;
  undatedStoredTemp: number;
  recentHandMarks: number;
  recentBySource: HandMarkSourceCounts;
  calibrationHandMarks: number;
  calibrationBySource: HandMarkSourceCounts;
  standingOn: HandMarkLineStanding;
  lineCanFire: boolean;
  recentDropdown: HandMarkSample[];
};

const BUCKET_RANK: Record<LeadTemp, number> = {
  cold: 0,
  lukewarm: 1,
  warm: 2,
  hot: 3,
};

function ageDays(at: string | null | undefined, asOf: Date): number | null {
  if (!at) {
    return null;
  }
  const elapsed = asOf.getTime() - new Date(at).getTime();
  if (!Number.isFinite(elapsed)) {
    return null;
  }
  return Math.max(0, Math.floor(elapsed / MS_PER_DAY));
}

function classifyDropAge(days: number | null): keyof ScoreDryRunDropAge {
  if (days === null) {
    return "unknown";
  }
  if (days < 21) {
    return "recentUnder21d";
  }
  if (days >= 90) {
    return "oldOver90d";
  }
  return "mid";
}

const HAND_READ_LIMIT = 20;
const RECENT_DROPDOWN_SAMPLE = 20;

export function summarizeDryRun(
  rows: readonly ScoreDryRunRow[],
  asOf: Date,
  peopleComponents: readonly (readonly ScoreComponent[])[] = [],
  caps: readonly (ScoreCapApplied | null)[] = [],
  skipped = 0,
): ScoreDryRunReport {
  const byBucket: Record<LeadTemp, number> = {
    cold: 0,
    lukewarm: 0,
    warm: 0,
    hot: 0,
  };
  let nullManual = 0;
  let hysteresisSeeds = 0;
  let drops = 0;
  let rises = 0;
  const dropAge: ScoreDryRunDropAge = {
    recentUnder21d: 0,
    mid: 0,
    oldOver90d: 0,
    unknown: 0,
  };
  const disagreements: ScoreDryRunRow[] = [];
  let recentHandMarks = 0;
  let recentDisagreements = 0;
  let recentDrops = 0;
  let recentRises = 0;
  let calibrationHandMarks = 0;
  let calibrationDisagreements = 0;
  let calibrationDropdownDisagreements = 0;
  const recentBySource = emptyHandMarkSourceCounts();
  const calibrationBySource = emptyHandMarkSourceCounts();
  for (const row of rows) {
    byBucket[row.engineBucket] += 1;
    const manualAgeDays = ageDays(row.manualAt, asOf);
    const dated: ScoreDryRunRow = { ...row, manualAgeDays };
    if (row.manualBucket === null) {
      nullManual += 1;
      continue;
    }
    hysteresisSeeds += 1;
    const source = row.handMarkSource;
    const usable = !row.engineOwnsLeadTemp && source !== null;
    const recent = usable && isRecentHandMark(manualAgeDays);
    const calibration = usable && isCalibrationHandMark(manualAgeDays);
    if (recent && source) {
      recentHandMarks += 1;
      recentBySource[source] += 1;
    }
    if (calibration && source) {
      calibrationHandMarks += 1;
      calibrationBySource[source] += 1;
    }
    const delta = BUCKET_RANK[row.engineBucket] - BUCKET_RANK[row.manualBucket];
    if (delta === 0) {
      continue;
    }
    disagreements.push(dated);
    if (recent && source === "dropdown") {
      recentDisagreements += 1;
    }
    if (calibration) {
      calibrationDisagreements += 1;
      if (source === "dropdown") {
        calibrationDropdownDisagreements += 1;
      }
    }
    if (delta < 0) {
      drops += 1;
      dropAge[classifyDropAge(manualAgeDays)] += 1;
      if (recent && source === "dropdown") {
        recentDrops += 1;
      }
    } else {
      rises += 1;
      if (recent && source === "dropdown") {
        recentRises += 1;
      }
    }
  }
  disagreements.sort((a, b) => {
    const aGap = Math.abs(
      BUCKET_RANK[a.engineBucket] - BUCKET_RANK[a.manualBucket ?? a.engineBucket],
    );
    const bGap = Math.abs(
      BUCKET_RANK[b.engineBucket] - BUCKET_RANK[b.manualBucket ?? b.engineBucket],
    );
    const aAge = a.manualAgeDays ?? -1;
    const bAge = b.manualAgeDays ?? -1;
    return bGap - aGap || bAge - aAge || b.score - a.score;
  });
  const dropdownN = recentBySource.dropdown;
  const judgment = judgeWeightDisagreement({
    recentHandMarks: dropdownN,
    recentDisagreements,
  });
  const calibrationDropdown = calibrationBySource.dropdown;
  return {
    asOf: asOf.toISOString(),
    total: rows.length,
    nullManual,
    hysteresisSeeds,
    byBucket,
    drops,
    dropAge,
    rises,
    disagreements: disagreements.slice(0, 50),
    recentHandMarks,
    recentDisagreements: judgment.recentDisagreements,
    recentDrops,
    recentRises,
    recentDisagreeRate: judgment.rate,
    insufficientRecentMarks: judgment.insufficientRecentMarks,
    weightsWrong: judgment.weightsWrong,
    recentBySource,
    calibrationHandMarks,
    calibrationDisagreements,
    calibrationDisagreeRate:
      calibrationDropdown <= 0
        ? null
        : calibrationDropdownDisagreements / calibrationDropdown,
    calibrationBySource,
    handRead: disagreements
      .filter((row) => row.handMarkSource === "dropdown")
      .slice(0, HAND_READ_LIMIT),
    components: summarizeScoreComponentHistogram(peopleComponents),
    caps: summarizeScoreCapHistogram(caps),
    skipped,
  };
}

async function latestSnapshot(db: Database, personId: string) {
  const rows = await db
    .select()
    .from(personScoreSnapshots)
    .where(eq(personScoreSnapshots.personId, personId))
    .orderBy(desc(personScoreSnapshots.computedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function suppressionReason(
  db: Database,
  email: string,
  keyHex: string,
): Promise<SuppressionReason | null> {
  const hash = hmacSha256Hex(keyHex, canonicalEmail(email));
  const rows = await db
    .select({ reason: emailSuppressions.reason })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.emailHash, hash))
    .limit(1);
  const reason = rows[0]?.reason ?? null;
  if (!reason) {
    return null;
  }
  return suppressionReasonSchema.parse(reason);
}

function meetingOutcomeForScore(
  outcome: MeetingOutcome | null,
  status?: string,
): MeetingOutcome | null {
  if (status === "rescheduled") {
    return "rescheduled";
  }
  return outcome;
}

function addConversation(
  conversations: { at: number; kind: "meeting" | "call" }[],
  seen: Set<string>,
  key: string,
  at: number,
  kind: "meeting" | "call",
): void {
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  conversations.push({ at, kind });
}

export async function loadScoreFacts(
  db: Database,
  person: typeof people.$inferSelect,
  asOf: number,
  previousBucket: LeadTemp | null,
): Promise<{ facts: ScoreFacts; signalIds: string[] }> {
  const [incubator, meetingRows, meetingTaskRows, callRows, signalRows, altMap] =
    await Promise.all([
      db
        .select()
        .from(incubatorCards)
        .where(eq(incubatorCards.personId, person.id))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select()
        .from(meetings)
        .where(eq(meetings.personId, person.id)),
      db
        .select()
        .from(tasks)
        .where(and(eq(tasks.personId, person.id), eq(tasks.kind, "meeting"))),
      db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.personId, person.id),
            eq(tasks.kind, "call"),
            eq(tasks.status, "done"),
          ),
        ),
      db
        .select()
        .from(personSignals)
        .where(
          and(
            eq(personSignals.personId, person.id),
            isNull(personSignals.invalidatedAt),
          ),
        )
        .orderBy(desc(personSignals.createdAt)),
      listAlternateEmailsByPerson(db, [person.id]),
    ]);

  const personEmails = uniqueEmails([
    person.email,
    ...(altMap.get(person.id) ?? []),
  ]);
  const mailboxAddresses = mailboxEmails();
  const inboundReplies: { at: number }[] = [];
  const allMessages = await db
    .select({
      fromEmail: emailMessages.fromEmail,
      toEmails: emailMessages.toEmails,
      ccEmails: emailMessages.ccEmails,
      sentAt: emailMessages.sentAt,
    })
    .from(emailMessages)
    .innerJoin(emailThreads, eq(emailMessages.threadId, emailThreads.id))
    .where(eq(emailThreads.personId, person.id));
  for (const row of allMessages) {
    if (
      emailMessageDirection({
        fromEmail: row.fromEmail,
        personEmails,
        mailboxAddresses,
        toEmails: row.toEmails,
        ccEmails: row.ccEmails,
        threadMatched: true,
      }) === "inbound"
    ) {
      inboundReplies.push({ at: row.sentAt.getTime() });
    }
  }

  const conversations: { at: number; kind: "meeting" | "call" }[] = [];
  const seen = new Set<string>();
  for (const row of meetingRows) {
    if (
      !meetingHeldForScore({
        outcome: row.outcome,
        scheduledAt: row.scheduledAt.getTime(),
        asOf,
        attendeeAccepted: row.attendeeAccepted,
      })
    ) {
      continue;
    }
    addConversation(
      conversations,
      seen,
      row.calendarEventId ? `cal:${row.calendarEventId}` : `meeting:${row.id}`,
      row.scheduledAt.getTime(),
      "meeting",
    );
  }
  for (const row of meetingTaskRows) {
    if (
      !meetingHeldForScore({
        outcome: meetingOutcomeForScore(row.outcome, row.status),
        scheduledAt: row.dueAt.getTime(),
        asOf,
        attendeeAccepted: row.attendeeAccepted,
      })
    ) {
      continue;
    }
    addConversation(
      conversations,
      seen,
      row.calendarEventId ? `cal:${row.calendarEventId}` : `task:${row.id}`,
      row.dueAt.getTime(),
      "meeting",
    );
  }
  for (const row of callRows) {
    addConversation(
      conversations,
      seen,
      `call:${row.id}`,
      row.updatedAt.getTime(),
      "call",
    );
  }

  const extractedFindings: ExtractedSignal[] = [];
  let programFit: ScoreFacts["programFit"] = "unknown";
  let operatorTemp: ScoreFacts["operatorTemp"] = null;
  for (const row of signalRows) {
    if (row.kind === "program_fit" && programFit === "unknown") {
      const parsed = programFitSignalValueSchema.safeParse(row.value);
      if (parsed.success) {
        programFit = parsed.data.fit;
      }
    }
    if (row.kind === "warmth" && operatorTemp === null) {
      const parsed = warmthSignalValueSchema.safeParse(row.value);
      if (parsed.success) {
        operatorTemp = { level: parsed.data.level, at: parsed.data.at };
      }
    }
    extractedFindings.push({
      kind: row.kind,
      value: row.value,
      excerpt: row.excerpt ?? row.kind,
    });
  }

  const stage = incubator?.stage ?? null;
  const facts: ScoreFacts = {
    budgetQualified: person.budgetQualified,
    programTrack: person.programTrack,
    programInterest: person.programInterest,
    incubatorTier: incubator?.tier ?? null,
    priceUsd: incubator?.priceUsd ?? null,
    applicationCompleted: stage === "applied" || stage === "approved",
    conversations,
    inboundReplies,
    programFit,
    previousBucket,
    asOf,
    extracted: foldExtractedSignals(extractedFindings),
    operatorTemp,
  };

  return {
    facts,
    signalIds: signalRows.map((row) => row.id),
  };
}

function snapshotInputs(
  facts: ScoreFacts,
  signalIds: string[],
  formulaVersion: string,
): PersonScoreSnapshotInputs {
  return personScoreSnapshotInputsSchema.parse({
    formulaVersion,
    asOf: facts.asOf,
    previousBucket: facts.previousBucket ?? null,
    budgetQualified: facts.budgetQualified,
    programTrack: facts.programTrack ?? null,
    programInterest: facts.programInterest ?? null,
    incubatorTier: facts.incubatorTier ?? null,
    priceUsd: facts.priceUsd ?? null,
    applicationCompleted: facts.applicationCompleted,
    conversations: facts.conversations,
    inboundReplies: facts.inboundReplies,
    programFit: facts.programFit,
    extracted: facts.extracted ?? {
      statedProgramFee: false,
      explicitProgramFit: "unknown",
      timeline: "unknown",
    },
    operatorTemp: facts.operatorTemp ?? null,
    signalIds,
  });
}

export async function runScore(
  db: Database,
  env: ScoreAdapterEnv,
  input: {
    personId: string;
    asOf: Date;
    trigger: ScoreTrigger;
    mode: ScoreRunMode;
    computedBy?: string | null;
    formula?: ScoreFormulaConfig;
  },
): Promise<{
  skipped: boolean;
  breakdown: ScoreBreakdown | null;
  dryRow: ScoreDryRunRow | null;
}> {
  scoreTriggerSchema.parse(input.trigger);
  const personRows = await db
    .select()
    .from(people)
    .where(and(eq(people.id, input.personId), isNull(people.deletedAt)))
    .limit(1);
  const person = personRows[0];
  if (!person) {
    return { skipped: true, breakdown: null, dryRow: null };
  }
  const reason = await suppressionReason(db, person.email, env.EMAIL_HASH_KEY);
  const suppressed = shouldSkipScore(reason) || person.doNotContact;
  if (suppressed) {
    if (input.mode === "commit") {
      await persistCampaignTag(db, env, {
        person,
        bucket: null,
        suppressionReason: reason,
        asOf: input.asOf,
      });
    }
    return { skipped: true, breakdown: null, dryRow: null };
  }

  const latest = await latestSnapshot(db, person.id);
  const firstRun = latest === null;
  const previousBucket = firstRun
    ? person.leadTemp
    : (latest.bucket as LeadTemp);
  const loaded = await loadScoreFacts(
    db,
    person,
    input.asOf.getTime(),
    previousBucket,
  );
  if (firstRun) {
    loaded.facts.operatorTemp = null;
  }

  const formula = input.formula ?? (await loadActiveScoreFormula(db));
  const breakdown = scoreContact(loaded.facts, formula);
  const dryRow: ScoreDryRunRow = {
    personId: person.id,
    email: person.email,
    manualBucket: person.leadTemp,
    engineBucket: breakdown.bucket,
    score: breakdown.score,
    holdSummary: breakdown.hold?.summary ?? null,
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
    manualAt: null,
    manualAgeDays: null,
    engineOwnsLeadTemp: !firstRun,
    handMarkSource: null,
  };

  if (input.mode === "dry") {
    return { skipped: false, breakdown, dryRow };
  }

  const decision = planScorePersist({
    suppressed: false,
    latest: latest
      ? {
          id: latest.id,
          score: latest.score,
          bucket: latest.bucket,
          rawBucket: latest.rawBucket,
          trigger: scoreTriggerSchema.parse(latest.trigger),
        }
      : null,
    breakdown,
  });

  if (decision.action === "touch") {
    await db
      .update(personScoreSnapshots)
      .set({ computedAt: input.asOf, updatedAt: input.asOf })
      .where(eq(personScoreSnapshots.id, decision.snapshotId));
    await persistCampaignTag(db, env, {
      person: { ...person, leadTemp: breakdown.bucket, score: breakdown.score },
      bucket: breakdown.bucket,
      suppressionReason: reason,
      asOf: input.asOf,
    });
    return { skipped: false, breakdown, dryRow };
  }

  const inputs = snapshotInputs(
    loaded.facts,
    loaded.signalIds,
    breakdown.configVersion,
  );
  await db.insert(personScoreSnapshots).values({
    personId: person.id,
    formulaVersion: breakdown.configVersion,
    score: breakdown.score,
    bucket: breakdown.bucket,
    rawBucket: breakdown.rawBucket,
    hold: breakdown.hold,
    asOf: input.asOf,
    trigger: input.trigger,
    components: breakdown.components,
    inputs,
    computedAt: input.asOf,
    computedBy: input.computedBy ?? null,
  });
  await db
    .update(people)
    .set({
      score: breakdown.score,
      leadTemp: breakdown.bucket,
    })
    .where(eq(people.id, person.id));

  await persistCampaignTag(db, env, {
    person: { ...person, leadTemp: breakdown.bucket, score: breakdown.score },
    bucket: breakdown.bucket,
    suppressionReason: reason,
    asOf: input.asOf,
  });

  if (input.trigger === "nightly" && latest) {
    const drift = planNightlyDrift({
      latest: {
        id: latest.id,
        score: latest.score,
        bucket: latest.bucket,
        rawBucket: latest.rawBucket,
        trigger: scoreTriggerSchema.parse(latest.trigger),
      },
      nightly: breakdown,
    });
    if (drift.flag) {
      await db
        .update(people)
        .set({ needsReview: true })
        .where(eq(people.id, person.id));
      await writeActivity(db, {
        personId: person.id,
        userId: input.computedBy ?? null,
        type: "field_change",
        payload: {
          who: { id: input.computedBy ?? "system", email: "score.nightly" },
          what: "score.nightly_drift",
          when: input.asOf.toISOString(),
          before: { score: latest.score, bucket: latest.bucket },
          after: { score: breakdown.score, bucket: breakdown.bucket },
        },
      });
    }
  }

  return { skipped: false, breakdown, dryRow };
}

async function loadHandMarkActivity(db: Database): Promise<{
  writes: Map<string, { at: Date; source: HandMarkSource }>;
  imports: Map<string, Date>;
}> {
  const [leadRows, importRows] = await Promise.all([
    db
      .select({
        personId: activities.personId,
        occurredAt: activities.occurredAt,
        type: activities.type,
        payload: activities.payload,
      })
      .from(activities)
      .where(sql`${activities.payload}->'after' ? 'leadTemp'`)
      .orderBy(desc(activities.occurredAt)),
    db
      .select({
        personId: activities.personId,
        occurredAt: activities.occurredAt,
      })
      .from(activities)
      .where(eq(activities.type, "import"))
      .orderBy(desc(activities.occurredAt)),
  ]);
  const importTimes = new Map<string, number[]>();
  const imports = new Map<string, Date>();
  for (const row of importRows) {
    if (!row.personId) {
      continue;
    }
    const times = importTimes.get(row.personId) ?? [];
    times.push(row.occurredAt.getTime());
    importTimes.set(row.personId, times);
    if (!imports.has(row.personId)) {
      imports.set(row.personId, row.occurredAt);
    }
  }
  const writes = new Map<string, { at: Date; source: HandMarkSource }>();
  for (const row of leadRows) {
    if (!row.personId || writes.has(row.personId)) {
      continue;
    }
    writes.set(row.personId, {
      at: row.occurredAt,
      source: classifyLeadTempWriteSource({
        activityType: row.type,
        what: row.payload.what,
        after: row.payload.after,
        pairedImport: importsPairedWith(
          row.occurredAt.getTime(),
          importTimes.get(row.personId) ?? [],
        ),
      }),
    });
  }
  return { writes, imports };
}

function resolveHandMark(
  personId: string,
  leadTemp: LeadTemp | null,
  writes: Map<string, { at: Date; source: HandMarkSource }>,
  imports: Map<string, Date>,
): { at: Date; source: HandMarkSource } | null {
  const write = writes.get(personId);
  if (write) {
    return write;
  }
  if (leadTemp === null) {
    return null;
  }
  const importedAt = imports.get(personId);
  if (!importedAt) {
    return null;
  }
  return { at: importedAt, source: "import" };
}

export async function countHandMarks(
  db: Database,
  asOf: Date,
): Promise<HandMarkCountReport> {
  const [peopleRows, activity, snapshotRows] = await Promise.all([
    db
      .select({
        id: people.id,
        email: people.email,
        leadTemp: people.leadTemp,
      })
      .from(people)
      .where(isNull(people.deletedAt)),
    loadHandMarkActivity(db),
    db
      .select({ personId: personScoreSnapshots.personId })
      .from(personScoreSnapshots),
  ]);
  const { writes, imports } = activity;
  const engineOwnedIds = new Set(snapshotRows.map((row) => row.personId));
  let withStoredTemp = 0;
  let undatedStoredTemp = 0;
  let recentHandMarks = 0;
  let calibrationHandMarks = 0;
  let engineOwned = 0;
  const recentBySource = emptyHandMarkSourceCounts();
  const calibrationBySource = emptyHandMarkSourceCounts();
  const recentDropdown: HandMarkSample[] = [];
  for (const person of peopleRows) {
    if (engineOwnedIds.has(person.id)) {
      engineOwned += 1;
    }
    if (person.leadTemp !== null) {
      withStoredTemp += 1;
    }
    if (engineOwnedIds.has(person.id)) {
      continue;
    }
    const mark = resolveHandMark(
      person.id,
      person.leadTemp,
      writes,
      imports,
    );
    if (!mark) {
      if (person.leadTemp !== null) {
        undatedStoredTemp += 1;
      }
      continue;
    }
    const days = ageDays(mark.at.toISOString(), asOf);
    if (isRecentHandMark(days)) {
      recentHandMarks += 1;
      recentBySource[mark.source] += 1;
      if (mark.source === "dropdown") {
        recentDropdown.push({
          personId: person.id,
          email: person.email,
          leadTemp: person.leadTemp,
          source: mark.source,
          at: mark.at.toISOString(),
          ageDays: days,
        });
      }
    }
    if (isCalibrationHandMark(days)) {
      calibrationHandMarks += 1;
      calibrationBySource[mark.source] += 1;
    }
  }
  recentDropdown.sort((a, b) => (a.ageDays ?? 0) - (b.ageDays ?? 0));
  const standingOn = handMarkLineStanding(recentBySource);
  return {
    asOf: asOf.toISOString(),
    people: peopleRows.length,
    withStoredTemp,
    datedWrites: writes.size,
    engineOwned,
    undatedStoredTemp,
    recentHandMarks,
    recentBySource,
    calibrationHandMarks,
    calibrationBySource,
    standingOn,
    lineCanFire: standingOn === "dropdown",
    recentDropdown: recentDropdown.slice(0, RECENT_DROPDOWN_SAMPLE),
  };
}

export async function dryRunAll(
  db: Database,
  env: ScoreAdapterEnv,
  asOf: Date,
): Promise<ScoreDryRunReport> {
  const [peopleRows, activity] = await Promise.all([
    db.select().from(people).where(isNull(people.deletedAt)),
    loadHandMarkActivity(db),
  ]);
  const { writes, imports } = activity;
  const results: ScoreDryRunRow[] = [];
  const peopleComponents: ScoreComponent[][] = [];
  const caps: (ScoreCapApplied | null)[] = [];
  let skipped = 0;
  for (const person of peopleRows) {
    const result = await runScore(db, env, {
      personId: person.id,
      asOf,
      trigger: "dry_run",
      mode: "dry",
    });
    if (result.skipped || !result.dryRow) {
      skipped += 1;
      continue;
    }
    const mark = resolveHandMark(
      person.id,
      person.leadTemp,
      writes,
      imports,
    );
    results.push({
      ...result.dryRow,
      manualAt: mark ? mark.at.toISOString() : null,
      handMarkSource: mark?.source ?? null,
    });
    if (result.breakdown) {
      peopleComponents.push(result.breakdown.components);
      caps.push(result.breakdown.capApplied);
    }
  }
  return summarizeDryRun(results, asOf, peopleComponents, caps, skipped);
}

export async function nightlyScoreAll(
  db: Database,
  env: ScoreAdapterEnv,
  asOf: Date,
): Promise<{ scored: number; drifted: number }> {
  const rows = await db
    .select({ id: people.id })
    .from(people)
    .where(and(isNull(people.deletedAt), eq(people.doNotContact, false)));
  const formula = await loadActiveScoreFormula(db);
  let scored = 0;
  let drifted = 0;
  for (const person of rows) {
    const before = await db
      .select({ needsReview: people.needsReview })
      .from(people)
      .where(eq(people.id, person.id))
      .limit(1);
    const result = await runScore(db, env, {
      personId: person.id,
      asOf,
      trigger: "nightly",
      mode: "commit",
      formula,
    });
    if (result.skipped) {
      continue;
    }
    scored += 1;
    const after = await db
      .select({ needsReview: people.needsReview })
      .from(people)
      .where(eq(people.id, person.id))
      .limit(1);
    if (after[0]?.needsReview && !before[0]?.needsReview) {
      drifted += 1;
    }
  }
  return { scored, drifted };
}

export type ScoreInspectRaw = {
  meetingsTotal: number;
  meetingsHeld: number;
  meetings: {
    source: "meeting" | "task";
    outcome: string | null;
    scheduledAt: string;
    attendeeAccepted: boolean;
  }[];
  callTasksTotal: number;
  callTasksDone: number;
  messagesTotal: number;
  inboundLoaded: number;
  messages: {
    fromEmail: string;
    toEmails: string[];
    direction: string;
    sentAt: string;
  }[];
  incubatorStage: string | null;
};

export type ScoreInspectRosterRow = {
  personId: string;
  email: string;
  name: string;
  score: number;
  bucket: LeadTemp;
  conversations: number;
  inboundReplies: number;
  applicationCompleted: boolean;
  meetingsTotal: number;
  messagesTotal: number;
};

export type ScoreInspectFocus = {
  personId: string;
  email: string;
  name: string;
  leadTemp: LeadTemp | null;
  budgetQualified: string;
  programTrack: string | null;
  score: number;
  bucket: LeadTemp;
  holdSummary: string | null;
  firstRun: boolean;
  facts: ScoreFacts;
  components: ScoreBreakdown["components"];
  raw: ScoreInspectRaw;
  crmHasEvents: boolean;
  loaderDroppedEvents: boolean;
};

function inspectRank(a: ScoreInspectRosterRow, b: ScoreInspectRosterRow): number {
  return (
    b.score - a.score ||
    b.conversations - a.conversations ||
    b.inboundReplies - a.inboundReplies ||
    Number(b.applicationCompleted) - Number(a.applicationCompleted) ||
    b.meetingsTotal + b.messagesTotal - (a.meetingsTotal + a.messagesTotal)
  );
}

async function loadScoreRaw(
  db: Database,
  person: typeof people.$inferSelect,
  personEmails: readonly string[],
): Promise<Omit<ScoreInspectRaw, "inboundLoaded" | "meetingsHeld">> {
  const [meetingRows, meetingTaskRows, callRows, messageRows, incubator] =
    await Promise.all([
      db
        .select({
          outcome: meetings.outcome,
          scheduledAt: meetings.scheduledAt,
          attendeeAccepted: meetings.attendeeAccepted,
        })
        .from(meetings)
        .where(eq(meetings.personId, person.id)),
      db
        .select({
          outcome: tasks.outcome,
          status: tasks.status,
          dueAt: tasks.dueAt,
          attendeeAccepted: tasks.attendeeAccepted,
        })
        .from(tasks)
        .where(and(eq(tasks.personId, person.id), eq(tasks.kind, "meeting"))),
      db
        .select({ status: tasks.status })
        .from(tasks)
        .where(and(eq(tasks.personId, person.id), eq(tasks.kind, "call"))),
      db
        .select({
          fromEmail: emailMessages.fromEmail,
          toEmails: emailMessages.toEmails,
          ccEmails: emailMessages.ccEmails,
          sentAt: emailMessages.sentAt,
        })
        .from(emailMessages)
        .innerJoin(emailThreads, eq(emailMessages.threadId, emailThreads.id))
        .where(eq(emailThreads.personId, person.id)),
      db
        .select({ stage: incubatorCards.stage })
        .from(incubatorCards)
        .where(eq(incubatorCards.personId, person.id))
        .limit(1),
    ]);
  const mailboxAddresses = mailboxEmails();
  const inspectMeetings = [
    ...meetingRows.map((row) => ({
      source: "meeting" as const,
      outcome: row.outcome,
      scheduledAt: row.scheduledAt.toISOString(),
      attendeeAccepted: row.attendeeAccepted,
    })),
    ...meetingTaskRows.map((row) => ({
      source: "task" as const,
      outcome: meetingOutcomeForScore(row.outcome, row.status),
      scheduledAt: row.dueAt.toISOString(),
      attendeeAccepted: row.attendeeAccepted,
    })),
  ];
  return {
    meetingsTotal: inspectMeetings.length,
    meetings: inspectMeetings,
    callTasksTotal: callRows.length,
    callTasksDone: callRows.filter((row) => row.status === "done").length,
    messagesTotal: messageRows.length,
    messages: messageRows.map((row) => ({
      fromEmail: row.fromEmail,
      toEmails: row.toEmails,
      direction: emailMessageDirection({
        fromEmail: row.fromEmail,
        personEmails,
        mailboxAddresses,
        toEmails: row.toEmails,
        ccEmails: row.ccEmails,
        threadMatched: true,
      }),
      sentAt: row.sentAt.toISOString(),
    })),
    incubatorStage: incubator[0]?.stage ?? null,
  };
}

export async function inspectWarmestPerson(
  db: Database,
  env: ScoreAdapterEnv,
  asOf: Date,
  email?: string,
): Promise<{
  roster: ScoreInspectRosterRow[];
  focus: ScoreInspectFocus | null;
}> {
  const filter = email
    ? await (async () => {
        const match = await findPersonByEmail(db, email);
        return match
          ? and(isNull(people.deletedAt), eq(people.id, match.id))
          : and(isNull(people.deletedAt), eq(people.email, email.toLowerCase()));
      })()
    : isNull(people.deletedAt);
  const personRows = await db.select().from(people).where(filter);
  const roster: ScoreInspectRosterRow[] = [];
  const inspected: {
    person: typeof people.$inferSelect;
    facts: ScoreFacts;
    breakdown: ScoreBreakdown;
    raw: ScoreInspectRaw;
    firstRun: boolean;
  }[] = [];

  const formula = await loadActiveScoreFormula(db);
  for (const person of personRows) {
    const latest = await latestSnapshot(db, person.id);
    const firstRun = latest === null;
    const previousBucket = firstRun ? person.leadTemp : latest.bucket;
    const loaded = await loadScoreFacts(db, person, asOf.getTime(), previousBucket);
    if (firstRun) {
      loaded.facts.operatorTemp = null;
    }
    const altMap = await listAlternateEmailsByPerson(db, [person.id]);
    const personEmails = uniqueEmails([
      person.email,
      ...(altMap.get(person.id) ?? []),
    ]);
    const breakdown = scoreContact(loaded.facts, formula);
    const baseRaw = await loadScoreRaw(db, person, personEmails);
    const raw: ScoreInspectRaw = {
      ...baseRaw,
      meetingsHeld: loaded.facts.conversations.filter((row) => row.kind === "meeting").length,
      inboundLoaded: loaded.facts.inboundReplies.length,
    };
    inspected.push({ person, facts: loaded.facts, breakdown, raw, firstRun });
    roster.push({
      personId: person.id,
      email: person.email,
      name: `${person.firstName} ${person.lastName}`,
      score: breakdown.score,
      bucket: breakdown.bucket,
      conversations: loaded.facts.conversations.length,
      inboundReplies: loaded.facts.inboundReplies.length,
      applicationCompleted: loaded.facts.applicationCompleted,
      meetingsTotal: raw.meetingsTotal,
      messagesTotal: raw.messagesTotal,
    });
  }

  roster.sort(inspectRank);
  const winner = roster[0];
  const focusRow = winner
    ? inspected.find((row) => row.person.id === winner.personId)
    : undefined;
  if (!focusRow) {
    return { roster, focus: null };
  }

  const loadedEmpty =
    focusRow.facts.conversations.length === 0 &&
    focusRow.facts.inboundReplies.length === 0 &&
    !focusRow.facts.applicationCompleted;
  const crmHasEvents =
    focusRow.raw.meetingsTotal > 0 ||
    focusRow.raw.callTasksTotal > 0 ||
    focusRow.raw.messagesTotal > 0 ||
    focusRow.raw.incubatorStage !== null;

  return {
    roster,
    focus: {
      personId: focusRow.person.id,
      email: focusRow.person.email,
      name: `${focusRow.person.firstName} ${focusRow.person.lastName}`,
      leadTemp: focusRow.person.leadTemp,
      budgetQualified: focusRow.person.budgetQualified,
      programTrack: focusRow.person.programTrack,
      score: focusRow.breakdown.score,
      bucket: focusRow.breakdown.bucket,
      holdSummary: focusRow.breakdown.hold?.summary ?? null,
      firstRun: focusRow.firstRun,
      facts: focusRow.facts,
      components: focusRow.breakdown.components,
      raw: focusRow.raw,
      crmHasEvents,
      loaderDroppedEvents: loadedEmpty && crmHasEvents,
    },
  };
}

