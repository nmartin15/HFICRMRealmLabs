import { describe, expect, it } from "vitest";
import { EMPTY_EXTRACTED_SCORE_FACTS } from "./signals";
import {
  applicationCompletedFromCrm,
  applyHysteresis,
  campaignScoreView,
  decayFactor,
  displayScoreBucket,
  explainDisplayVsCampaign,
  inspectScoreView,
  isCalibrationHandMark,
  isRecentHandMark,
  judgeWeightDisagreement,
  classifyLeadTempWriteSource,
  handMarkLineStanding,
  histogramReasonKey,
  importsPairedWith,
  MS_PER_DAY,
  nextScoreFormulaVersion,
  overrideAgainstComputed,
  planLeadTempPatch,
  planNightlyDrift,
  planScorePersist,
  planScoreRecompute,
  enqueueCoalescedScoreJob,
  planScoreJobEnqueue,
  scoreRecomputeJobId,
  replaySnapshotWithConfig,
  SCORE_FORMULA_V1,
  scoreContact,
  scoreFactsFromSnapshotInputs,
  type ScoreFacts,
  summarizeOverrideRollup,
  summarizeScoreComponentHistogram,
  summarizeScoreReplay,
} from "./scoring";

const AS_OF = Date.UTC(2026, 8, 12);

function facts(overrides: Partial<ScoreFacts> = {}): ScoreFacts {
  return {
    budgetQualified: "unknown",
    programTrack: null,
    programInterest: null,
    incubatorTier: null,
    priceUsd: null,
    applicationCompleted: false,
    conversations: [],
    inboundReplies: [],
    programFit: "unknown",
    previousBucket: null,
    asOf: AS_OF,
    ...overrides,
  };
}

function component(
  breakdown: ReturnType<typeof scoreContact>,
  id: (typeof breakdown.components)[number]["id"],
) {
  const found = breakdown.components.find((item) => item.id === id);
  if (!found) {
    throw new Error(`missing component ${id}`);
  }
  return found;
}

describe("campaign display", () => {
  it("shows integer score, 25/50/75 display bucket, and hysteresis campaign bucket", () => {
    const first = scoreContact(
      facts({
        budgetQualified: "heavy",
        programTrack: "incubator",
        programInterest: "hedge_fund_incubator",
        applicationCompleted: true,
        conversations: [
          { at: AS_OF, kind: "meeting" },
          { at: AS_OF, kind: "meeting" },
        ],
        inboundReplies: [{ at: AS_OF }, { at: AS_OF }],
        programFit: "no",
      }),
    );
    expect(first.score).toBe(79);
    expect(campaignScoreView(first)).toEqual({
      score: 79,
      bucket: "warm",
      hold: null,
    });
    expect(displayScoreBucket(79)).toBe("hot");
    expect(
      explainDisplayVsCampaign({
        score: 79,
        displayBucket: "hot",
        campaignBucket: "warm",
        hysteresis: SCORE_FORMULA_V1.hysteresis,
      }),
    ).toBe(
      "This contact scores 79 and displays as hot, but stays in the warm campaign because they have not cleared the hot enter threshold (80) since their last bucket change.",
    );
    expect(inspectScoreView(79, "warm")).toMatchObject({
      score: 79,
      campaignBucket: "warm",
      displayBucket: "hot",
    });

    const held = scoreContact(
      facts({
        budgetQualified: "heavy",
        programTrack: "incubator",
        programInterest: "hedge_fund_incubator",
        applicationCompleted: true,
        conversations: [
          { at: AS_OF, kind: "meeting" },
          { at: AS_OF, kind: "meeting" },
        ],
        inboundReplies: [{ at: AS_OF }, { at: AS_OF }],
        programFit: "no",
        previousBucket: "hot",
      }),
    );
    expect(campaignScoreView(held)).toEqual({
      score: 79,
      bucket: "hot",
      hold: {
        reason: "downward_hysteresis",
        score: 79,
        rawBucket: "warm",
        bucket: "hot",
        enterAt: 80,
        dropsBelow: 68,
        summary:
          "79 is below 80 to enter hot; campaign stays hot until below 68",
      },
    });
    expect(inspectScoreView(79, "hot").explanation).toBeNull();
    expect(inspectScoreView(70, "hot").explanation).toBe(
      "This contact scores 70 and displays as warm, but stays in the hot campaign until they drop below 68.",
    );
  });
});

describe("SCORE_FORMULA_V1", () => {
  it("weights sum to 100", () => {
    const { weights } = SCORE_FORMULA_V1;
    expect(
      weights.affordability +
        weights.conversations +
        weights.application +
        weights.replies +
        weights.qualification,
    ).toBe(100);
    expect(SCORE_FORMULA_V1.extracted.maxContribution).toBe(8);
    expect(SCORE_FORMULA_V1.operator.maxContribution).toBe(10);
    expect(SCORE_FORMULA_V1.operator.minContribution).toBe(-10);
    expect(SCORE_FORMULA_V1.operator.pointsByLevel).toEqual({
      skeptical: -6,
      watch: 3,
      pursue: 7,
      priority: 10,
    });
  });
});

describe("decayFactor", () => {
  it("is 1 at or before as-of, half at half-life, and 0 at max age", () => {
    expect(decayFactor(0, 21, 90)).toBe(1);
    expect(decayFactor(-3, 21, 90)).toBe(1);
    expect(decayFactor(21, 21, 90)).toBe(0.5);
    expect(decayFactor(90, 21, 90)).toBe(0);
    expect(decayFactor(91, 21, 90)).toBe(0);
  });
});

describe("applyHysteresis", () => {
  const { hysteresis } = SCORE_FORMULA_V1;

  it("uses enter thresholds when there is no previous bucket", () => {
    expect(applyHysteresis(29, null, hysteresis)).toBe("cold");
    expect(applyHysteresis(30, null, hysteresis)).toBe("lukewarm");
    expect(applyHysteresis(54, null, hysteresis)).toBe("lukewarm");
    expect(applyHysteresis(55, null, hysteresis)).toBe("warm");
    expect(applyHysteresis(79, null, hysteresis)).toBe("warm");
    expect(applyHysteresis(80, null, hysteresis)).toBe("hot");
  });

  it("upgrades at enter with no extra margin", () => {
    expect(applyHysteresis(54, "lukewarm", hysteresis)).toBe("lukewarm");
    expect(applyHysteresis(55, "lukewarm", hysteresis)).toBe("warm");
    expect(applyHysteresis(55, "cold", hysteresis)).toBe("warm");
    expect(applyHysteresis(79, "warm", hysteresis)).toBe("warm");
    expect(applyHysteresis(80, "warm", hysteresis)).toBe("hot");
    expect(applyHysteresis(80, "cold", hysteresis)).toBe("hot");
  });

  it("holds downward until the exit floor, then drops to enter", () => {
    expect(applyHysteresis(79, "hot", hysteresis)).toBe("hot");
    expect(applyHysteresis(68, "hot", hysteresis)).toBe("hot");
    expect(applyHysteresis(67, "hot", hysteresis)).toBe("warm");
    expect(applyHysteresis(22, "lukewarm", hysteresis)).toBe("lukewarm");
    expect(applyHysteresis(21, "lukewarm", hysteresis)).toBe("cold");
  });
});

describe("scoreContact", () => {
  it("scores a heavy incubator applicant with fresh conversations and replies", () => {
    const breakdown = scoreContact(
      facts({
        budgetQualified: "heavy",
        programTrack: "incubator",
        programInterest: "hedge_fund_incubator",
        incubatorTier: "tier_2",
        priceUsd: 10_000,
        applicationCompleted: true,
        conversations: [
          { at: AS_OF, kind: "meeting" },
          { at: AS_OF, kind: "call" },
        ],
        inboundReplies: [{ at: AS_OF }, { at: AS_OF }],
        programFit: "unknown",
      }),
    );

    expect(component(breakdown, "affordability").contribution).toBe(35);
    expect(component(breakdown, "conversations").contribution).toBe(18);
    expect(component(breakdown, "application").contribution).toBe(15);
    expect(component(breakdown, "replies").contribution).toBe(11);
    expect(component(breakdown, "qualification").contribution).toBe(6);
    expect(breakdown.score).toBe(85);
    expect(breakdown.bucket).toBe("hot");
    expect(breakdown.rawBucket).toBe("hot");
    expect(breakdown.configVersion).toBe("2026-09-12.v1");
    expect(breakdown.capApplied).toBeNull();
  });

  it("zeros conversations and replies at the 90-day max age", () => {
    const aged = AS_OF - 90 * MS_PER_DAY;
    const breakdown = scoreContact(
      facts({
        budgetQualified: "heavy",
        programTrack: "incubator",
        programInterest: "hedge_fund_incubator",
        incubatorTier: "tier_2",
        applicationCompleted: true,
        conversations: [
          { at: aged, kind: "meeting" },
          { at: aged, kind: "meeting" },
          { at: aged, kind: "meeting" },
        ],
        inboundReplies: [{ at: aged }, { at: aged }, { at: aged }],
        programFit: "unknown",
        previousBucket: "hot",
      }),
    );

    expect(component(breakdown, "conversations").contribution).toBe(0);
    expect(component(breakdown, "replies").contribution).toBe(0);
    expect(breakdown.score).toBe(56);
    expect(breakdown.rawBucket).toBe("warm");
    expect(breakdown.bucket).toBe("warm");
    expect(breakdown.bucketChanged).toBe(true);
  });

  it("halves conversation points at the 21-day half-life", () => {
    const breakdown = scoreContact(
      facts({
        budgetQualified: "heavy",
        conversations: [
          { at: AS_OF - 21 * MS_PER_DAY, kind: "meeting" },
          { at: AS_OF - 21 * MS_PER_DAY, kind: "meeting" },
          { at: AS_OF - 21 * MS_PER_DAY, kind: "meeting" },
        ],
      }),
    );

    expect(component(breakdown, "conversations").raw).toBe(25);
    expect(component(breakdown, "conversations").contribution).toBe(13);
  });

  it("caps unknown budget at 49 so the campaign bucket cannot leave lukewarm", () => {
    const breakdown = scoreContact(
      facts({
        budgetQualified: "unknown",
        programTrack: "incubator",
        programInterest: "hedge_fund_incubator",
        applicationCompleted: true,
        conversations: [
          { at: AS_OF, kind: "meeting" },
          { at: AS_OF, kind: "meeting" },
          { at: AS_OF, kind: "meeting" },
        ],
        inboundReplies: [{ at: AS_OF }, { at: AS_OF }, { at: AS_OF }],
      }),
    );

    expect(breakdown.uncappedScore).toBe(69);
    expect(breakdown.score).toBe(49);
    expect(breakdown.capApplied).toBe("unknown_budget");
    expect(breakdown.bucket).toBe("lukewarm");
  });

  it("caps not_qualified at 24 so the campaign bucket cannot leave cold", () => {
    const breakdown = scoreContact(
      facts({
        budgetQualified: "not_qualified",
        programTrack: "incubator",
        programInterest: "hedge_fund_incubator",
        applicationCompleted: true,
        conversations: [
          { at: AS_OF, kind: "meeting" },
          { at: AS_OF, kind: "meeting" },
          { at: AS_OF, kind: "meeting" },
        ],
        inboundReplies: [{ at: AS_OF }, { at: AS_OF }, { at: AS_OF }],
      }),
    );

    expect(breakdown.uncappedScore).toBe(61);
    expect(breakdown.score).toBe(24);
    expect(breakdown.capApplied).toBe("not_qualified");
    expect(breakdown.bucket).toBe("cold");
  });

  it("keeps a warm campaign bucket at 79 until the enter threshold for hot", () => {
    const warmStay = scoreContact(
      facts({
        budgetQualified: "heavy",
        programTrack: "incubator",
        programInterest: "hedge_fund_incubator",
        applicationCompleted: true,
        conversations: [
          { at: AS_OF, kind: "meeting" },
          { at: AS_OF, kind: "meeting" },
        ],
        inboundReplies: [{ at: AS_OF }, { at: AS_OF }],
        programFit: "no",
        previousBucket: "warm",
      }),
    );
    expect(warmStay.score).toBe(79);
    expect(warmStay.rawBucket).toBe("warm");
    expect(warmStay.bucket).toBe("warm");
    expect(warmStay.bucketChanged).toBe(false);

    const hotEnter = scoreContact(
      facts({
        budgetQualified: "heavy",
        programTrack: "incubator",
        programInterest: "hedge_fund_incubator",
        applicationCompleted: true,
        conversations: [
          { at: AS_OF, kind: "meeting" },
          { at: AS_OF, kind: "meeting" },
        ],
        inboundReplies: [{ at: AS_OF }, { at: AS_OF }],
        previousBucket: "warm",
      }),
    );
    expect(hotEnter.score).toBe(85);
    expect(hotEnter.bucket).toBe("hot");
    expect(hotEnter.bucketChanged).toBe(true);
  });

  it("awards full affordability for light vs incubator at or below $10k", () => {
    const tier2 = scoreContact(
      facts({
        budgetQualified: "light",
        programTrack: "incubator",
        incubatorTier: "tier_2",
      }),
    );
    expect(component(tier2, "affordability")).toMatchObject({
      contribution: 35,
      reason: "light_incubator_full",
    });

    const tier3 = scoreContact(
      facts({
        budgetQualified: "light",
        programTrack: "incubator",
        incubatorTier: "tier_3",
      }),
    );
    expect(component(tier3, "affordability")).toMatchObject({
      contribution: 12,
      reason: "light_incubator_mid",
    });

    const tier4 = scoreContact(
      facts({
        budgetQualified: "light",
        programTrack: "incubator",
        incubatorTier: "tier_4",
      }),
    );
    expect(component(tier4, "affordability")).toMatchObject({
      contribution: 0,
      reason: "light_incubator_out_of_range",
    });
  });

  it("uses the unpriced light score when the program has no incubator price", () => {
    const breakdown = scoreContact(
      facts({
        budgetQualified: "light",
        programTrack: "allocation",
      }),
    );
    expect(component(breakdown, "affordability")).toMatchObject({
      contribution: 22,
      reason: "light_unpriced",
    });
  });

  it("scores qualification from programFit, then interest vs track", () => {
    expect(
      component(
        scoreContact(facts({ programFit: "yes" })),
        "qualification",
      ).contribution,
    ).toBe(10);
    expect(
      component(
        scoreContact(facts({ programFit: "no" })),
        "qualification",
      ).contribution,
    ).toBe(0);

    expect(
      component(
        scoreContact(
          facts({
            programFit: "unknown",
            programTrack: "recruitment",
            programInterest: "quant_analyst_placement",
          }),
        ),
        "qualification",
      ),
    ).toMatchObject({ contribution: 6, reason: "interest_track_match" });

    expect(
      component(
        scoreContact(
          facts({
            programFit: "unknown",
            programTrack: "recruitment",
            programInterest: "hedge_fund_incubator",
          }),
        ),
        "qualification",
      ),
    ).toMatchObject({ contribution: 2, reason: "interest_track_other" });
  });

  it("does not award application points until applicationCompleted is marked", () => {
    expect(
      component(scoreContact(facts()), "application").contribution,
    ).toBe(0);
    expect(
      component(
        scoreContact(facts({ applicationCompleted: true })),
        "application",
      ).contribution,
    ).toBe(15);
  });

  it("treats a program track plus applied board stage as applied", () => {
    expect(
      applicationCompletedFromCrm({
        programTrack: null,
        incubatorStage: null,
        pipelineStage: null,
      }),
    ).toBe(false);
    expect(
      applicationCompletedFromCrm({
        programTrack: null,
        incubatorStage: null,
        pipelineStage: "applied",
      }),
    ).toBe(false);
    expect(
      applicationCompletedFromCrm({
        programTrack: "incubator",
        incubatorStage: "sent",
        pipelineStage: null,
      }),
    ).toBe(false);
    expect(
      applicationCompletedFromCrm({
        programTrack: "incubator",
        incubatorStage: "rejected",
        pipelineStage: null,
      }),
    ).toBe(false);
    expect(
      applicationCompletedFromCrm({
        programTrack: "incubator",
        incubatorStage: "applied",
        pipelineStage: null,
      }),
    ).toBe(true);
    expect(
      applicationCompletedFromCrm({
        programTrack: "incubator",
        incubatorStage: "approved",
        pipelineStage: null,
      }),
    ).toBe(true);
    expect(
      applicationCompletedFromCrm({
        programTrack: "allocation",
        incubatorStage: null,
        pipelineStage: "applied",
      }),
    ).toBe(true);
    expect(
      applicationCompletedFromCrm({
        programTrack: "recruitment",
        incubatorStage: "sent",
        pipelineStage: "contacted",
      }),
    ).toBe(true);
    expect(
      applicationCompletedFromCrm({
        programTrack: "capital_raising",
        incubatorStage: null,
        pipelineStage: "passed",
      }),
    ).toBe(true);
  });

  it("is deterministic for the same facts and asOf", () => {
    const input = facts({
      budgetQualified: "heavy",
      conversations: [{ at: AS_OF - 5 * MS_PER_DAY, kind: "meeting" }],
      inboundReplies: [{ at: AS_OF - 8 * MS_PER_DAY }],
    });
    expect(scoreContact(input)).toEqual(scoreContact(input));
  });

  it("caps extracted signals at 8 so they cannot replace a conversation", () => {
    const breakdown = scoreContact(
      facts({
        budgetQualified: "heavy",
        extracted: {
          statedProgramFee: true,
          explicitProgramFit: "yes",
          timeline: "now",
        },
      }),
    );
    expect(component(breakdown, "extracted").raw).toBe(10);
    expect(component(breakdown, "extracted").contribution).toBe(8);
    expect(component(breakdown, "extracted").reason).toMatch(/capped/);
  });

  it("scores operator judgment as a decaying bonus or malus, not campaign buckets", () => {
    const fresh = scoreContact(
      facts({
        budgetQualified: "heavy",
        operatorTemp: { level: "priority", at: AS_OF },
      }),
    );
    expect(component(fresh, "operator")).toMatchObject({
      raw: 10,
      contribution: 10,
    });

    const aged = scoreContact(
      facts({
        budgetQualified: "heavy",
        operatorTemp: { level: "priority", at: AS_OF - 90 * MS_PER_DAY },
      }),
    );
    expect(component(aged, "operator").contribution).toBe(0);

    expect(
      component(scoreContact(facts()), "operator").contribution,
    ).toBe(0);
    expect(
      component(
        scoreContact(
          facts({ operatorTemp: { level: "skeptical", at: AS_OF } }),
        ),
        "operator",
      ).contribution,
    ).toBe(-6);
    expect(
      component(
        scoreContact(
          facts({ operatorTemp: { level: "watch", at: AS_OF } }),
        ),
        "operator",
      ).contribution,
    ).toBe(3);
    expect(
      component(
        scoreContact(
          facts({ operatorTemp: { level: "pursue", at: AS_OF } }),
        ),
        "operator",
      ).contribution,
    ).toBe(7);
  });
});

describe("planScoreRecompute", () => {
  it("inserts a snapshot instead of mutating history", () => {
    expect(
      planScoreRecompute({ score: 80, formulaVersion: "2026-09-12.v1" }),
    ).toEqual({
      insertSnapshot: true,
      mutateExisting: false,
      score: 80,
      bucket: "hot",
    });
  });

  it("upgrades at enter immediately and holds downward from the previous bucket", () => {
    expect(
      planScoreRecompute({
        score: 80,
        formulaVersion: "2026-09-12.v1",
        previousBucket: "cold",
      }).bucket,
    ).toBe("hot");
    expect(
      planScoreRecompute({
        score: 79,
        formulaVersion: "2026-09-12.v1",
        previousBucket: "hot",
      }).bucket,
    ).toBe("hot");
  });

  it("rejects scores outside 0-100", () => {
    expect(() =>
      planScoreRecompute({ score: 101, formulaVersion: "v1" }),
    ).toThrow();
    expect(() =>
      planScoreRecompute({ score: -1, formulaVersion: "v1" }),
    ).toThrow();
  });
});

describe("planScorePersist", () => {
  it("skips send-blocked people, inserts on first run, and only touches computed_at when nothing changed", () => {
    const breakdown = { score: 40, bucket: "lukewarm" as const, rawBucket: "lukewarm" as const };
    expect(planScorePersist({ suppressed: true, latest: null, breakdown })).toEqual({
      action: "skip_suppressed",
    });
    expect(planScorePersist({ suppressed: false, latest: null, breakdown })).toEqual({
      action: "insert",
    });
    expect(
      planScorePersist({
        suppressed: false,
        latest: {
          id: "11111111-1111-1111-1111-111111111111",
          score: 40,
          bucket: "lukewarm",
          rawBucket: "lukewarm",
          trigger: "manual_edit",
        },
        breakdown,
      }),
    ).toEqual({
      action: "touch",
      snapshotId: "11111111-1111-1111-1111-111111111111",
    });
    expect(
      planScorePersist({
        suppressed: false,
        latest: {
          id: "11111111-1111-1111-1111-111111111111",
          score: 40,
          bucket: "lukewarm",
          rawBucket: "lukewarm",
          trigger: "manual_edit",
        },
        breakdown: { score: 55, bucket: "warm", rawBucket: "warm" },
      }),
    ).toEqual({ action: "insert" });
  });
});

describe("planLeadTempPatch", () => {
  it("rejects a direct lead_temp write after the engine owns the field", () => {
    expect(planLeadTempPatch(false)).toEqual({ reject: false });
    expect(planLeadTempPatch(true)).toEqual({
      reject: true,
      status: 409,
      code: "ENGINE_OWNS_LEAD_TEMP",
      message:
        "Campaign temp is scored automatically. Use operator judgment to push a lead up or down.",
    });
  });
});

describe("planNightlyDrift", () => {
  const latest = {
    id: "11111111-1111-1111-1111-111111111111",
    score: 40,
    bucket: "lukewarm" as const,
    rawBucket: "lukewarm" as const,
    trigger: "inbound_reply" as const,
  };

  it("flags bucket changes and score deltas of 5 or more versus event-driven snapshots", () => {
    expect(planNightlyDrift({ latest: null, nightly: { score: 40, bucket: "lukewarm" } })).toEqual({
      flag: false,
    });
    expect(
      planNightlyDrift({
        latest: { ...latest, trigger: "nightly" },
        nightly: { score: 80, bucket: "hot" },
      }),
    ).toEqual({ flag: false });
    expect(
      planNightlyDrift({
        latest,
        nightly: { score: 44, bucket: "lukewarm" },
      }),
    ).toEqual({ flag: false });
    expect(
      planNightlyDrift({
        latest,
        nightly: { score: 45, bucket: "lukewarm" },
      }),
    ).toEqual({ flag: true });
    expect(
      planNightlyDrift({
        latest,
        nightly: { score: 40, bucket: "warm" },
      }),
    ).toEqual({ flag: true });
  });
});

describe("override rollup and config replay", () => {
  it("treats an override as against-computed when it fights the rest of the score", () => {
    expect(overrideAgainstComputed(10, 20)).toBe(true);
    expect(overrideAgainstComputed(10, 80)).toBe(false);
    expect(overrideAgainstComputed(-6, 80)).toBe(true);
    expect(overrideAgainstComputed(-6, 20)).toBe(false);
    expect(
      summarizeOverrideRollup([
        { contribution: 10, daysOld: 10, scoreWithoutOperator: 20 },
        { contribution: 7, daysOld: 20, scoreWithoutOperator: 80 },
        { contribution: 0, daysOld: 90, scoreWithoutOperator: 40 },
      ]),
    ).toEqual({
      activeCount: 2,
      averageAgeDays: 15,
      againstComputedCount: 1,
      againstComputedRate: 0.5,
    });
  });

  it("replays snapshot inputs under a candidate config and counts campaign moves", () => {
    const breakdown = scoreContact(
      facts({
        budgetQualified: "heavy",
        applicationCompleted: true,
        previousBucket: "warm",
      }),
    );
    const inputs = scoreFactsFromSnapshotInputs({
      formulaVersion: SCORE_FORMULA_V1.version,
      asOf: AS_OF,
      previousBucket: "warm",
      budgetQualified: "heavy",
      programTrack: null,
      programInterest: null,
      incubatorTier: null,
      priceUsd: null,
      applicationCompleted: true,
      conversations: [],
      inboundReplies: [],
      programFit: "unknown",
      extracted: EMPTY_EXTRACTED_SCORE_FACTS,
      operatorTemp: null,
      signalIds: [],
    });
    expect(inputs.applicationCompleted).toBe(true);
    const replayed = replaySnapshotWithConfig(
      {
        formulaVersion: SCORE_FORMULA_V1.version,
        asOf: AS_OF,
        previousBucket: "warm",
        budgetQualified: "heavy",
        programTrack: null,
        programInterest: null,
        incubatorTier: null,
        priceUsd: null,
        applicationCompleted: true,
        conversations: [],
        inboundReplies: [],
        programFit: "unknown",
        extracted: EMPTY_EXTRACTED_SCORE_FACTS,
        operatorTemp: null,
        signalIds: [],
      },
      SCORE_FORMULA_V1,
    );
    expect(replayed.score).toBe(breakdown.score);
    expect(
      summarizeScoreReplay([
        { actualBucket: "warm", replayedBucket: "hot" },
        { actualBucket: "warm", replayedBucket: "warm" },
      ]),
    ).toEqual({
      total: 2,
      campaignChanges: 1,
      before: { cold: 0, lukewarm: 0, warm: 2, hot: 0 },
      after: { cold: 0, lukewarm: 0, warm: 1, hot: 1 },
    });
    expect(nextScoreFormulaVersion("2026-09-12.v1", "2026-09-12")).toBe(
      "2026-09-12.v2",
    );
    expect(nextScoreFormulaVersion("2026-09-12.v1", "2026-09-13")).toBe(
      "2026-09-13.v1",
    );
  });
});

describe("weight disagreement line", () => {
  it("needs eight recent hand marks and more than a quarter disagreeing", () => {
    expect(isRecentHandMark(20)).toBe(true);
    expect(isRecentHandMark(21)).toBe(false);
    expect(isRecentHandMark(null)).toBe(false);
    expect(
      judgeWeightDisagreement({ recentHandMarks: 0, recentDisagreements: 0 }),
    ).toEqual({
      recentHandMarks: 0,
      recentDisagreements: 0,
      rate: null,
      insufficientRecentMarks: true,
      weightsWrong: false,
    });
    expect(
      judgeWeightDisagreement({ recentHandMarks: 4, recentDisagreements: 2 }),
    ).toEqual({
      recentHandMarks: 4,
      recentDisagreements: 2,
      rate: 0.5,
      insufficientRecentMarks: true,
      weightsWrong: false,
    });
    expect(
      judgeWeightDisagreement({ recentHandMarks: 8, recentDisagreements: 2 }),
    ).toEqual({
      recentHandMarks: 8,
      recentDisagreements: 2,
      rate: 0.25,
      insufficientRecentMarks: false,
      weightsWrong: false,
    });
    expect(
      judgeWeightDisagreement({ recentHandMarks: 8, recentDisagreements: 3 }),
    ).toMatchObject({
      rate: 0.375,
      insufficientRecentMarks: false,
      weightsWrong: true,
    });
    expect(isCalibrationHandMark(20)).toBe(true);
    expect(isCalibrationHandMark(59)).toBe(true);
    expect(isCalibrationHandMark(60)).toBe(false);
    expect(isCalibrationHandMark(null)).toBe(false);
    expect(isRecentHandMark(40)).toBe(false);
    expect(isCalibrationHandMark(40)).toBe(true);
  });

  it("labels import sheet writes separately from dropdown person.update", () => {
    expect(
      classifyLeadTempWriteSource({
        activityType: "field_change",
        what: "person.update",
        after: { leadTemp: "hot" },
      }),
    ).toBe("dropdown");
    expect(
      classifyLeadTempWriteSource({
        activityType: "field_change",
        what: "person.update",
        after: {
          title: "PM",
          company: "X",
          location: "NY",
          resumeUrl: null,
          appliedAt: null,
          notes: null,
          leadTemp: "hot",
          budgetQualified: "unknown",
        },
      }),
    ).toBe("import");
    expect(
      classifyLeadTempWriteSource({
        activityType: "field_change",
        what: "person.update",
        after: { leadTemp: "hot" },
        pairedImport: true,
      }),
    ).toBe("import");
    expect(
      classifyLeadTempWriteSource({
        activityType: "import",
        what: "import",
        after: { filename: "book.csv", action: "create" },
      }),
    ).toBe("import");
    expect(
      classifyLeadTempWriteSource({
        activityType: "field_change",
        what: "inspect.gap_seed",
        after: { leadTemp: "warm" },
      }),
    ).toBe("other");
    expect(histogramReasonKey("count_2_decay_days_1")).toBe("has_events");
    expect(histogramReasonKey("no_conversations")).toBe("no_conversations");
    expect(
      importsPairedWith(1_000, [1_500, 10_000]),
    ).toBe(true);
    expect(importsPairedWith(1_000, [4_000])).toBe(false);
    expect(handMarkLineStanding({ dropdown: 8, import: 20 })).toBe("dropdown");
    expect(handMarkLineStanding({ dropdown: 2, import: 8 })).toBe("import_only");
    expect(handMarkLineStanding({ dropdown: 2, import: 2 })).toBe("insufficient");
  });
});

describe("score component histogram", () => {
  it("counts zeros versus firing contributions per component", () => {
    const report = summarizeScoreComponentHistogram([
      [
        {
          id: "conversations",
          max: 20,
          raw: 0,
          contribution: 0,
          reason: "no_conversations",
        },
        {
          id: "replies",
          max: 15,
          raw: 8,
          contribution: 8,
          reason: "count_1_decay_days_2",
        },
      ],
      [
        {
          id: "conversations",
          max: 20,
          raw: 12,
          contribution: 12,
          reason: "count_2_decay_days_1",
        },
        {
          id: "replies",
          max: 15,
          raw: 0,
          contribution: 0,
          reason: "no_replies",
        },
      ],
    ]);
    expect(report.conversations).toEqual({
      n: 2,
      zeroRaw: 1,
      firing: 1,
      firingRate: 0.5,
      sumContribution: 12,
      meanContribution: 6,
      maxContribution: 12,
      reasons: { no_conversations: 1, has_events: 1 },
    });
    expect(report.replies).toEqual({
      n: 2,
      zeroRaw: 1,
      firing: 1,
      firingRate: 0.5,
      sumContribution: 8,
      meanContribution: 4,
      maxContribution: 8,
      reasons: { has_events: 1, no_replies: 1 },
    });
    expect(report.affordability.n).toBe(0);
    expect(report.affordability.firingRate).toBeNull();
  });
});

describe("score job coalescing", () => {
  const PERSON = "11111111-1111-4111-8111-111111111111";
  const data = {
    personId: PERSON,
    trigger: "inbound_email" as const,
  };

  it("replaces completed and failed jobs, skips an in-flight job", () => {
    expect(planScoreJobEnqueue(null)).toBe("add");
    expect(planScoreJobEnqueue("delayed")).toBe("replace");
    expect(planScoreJobEnqueue("waiting")).toBe("replace");
    expect(planScoreJobEnqueue("completed")).toBe("replace");
    expect(planScoreJobEnqueue("failed")).toBe("replace");
    expect(planScoreJobEnqueue("paused")).toBe("replace");
    expect(planScoreJobEnqueue("active")).toBe("skip");
    expect(planScoreJobEnqueue("waiting-children")).toBe("skip");
    expect(scoreRecomputeJobId(PERSON)).toBe(`score-${PERSON}`);
  });

  it("removes a completed job before adding the same jobId", async () => {
    let removed = false;
    await enqueueCoalescedScoreJob({
      jobId: scoreRecomputeJobId(PERSON),
      data,
      delayMs: 1,
      getJob: async () => ({
        getState: async () => "completed",
        remove: async () => {
          removed = true;
        },
      }),
      add: async () => {
        if (!removed) {
          throw new Error("JobId already exists");
        }
      },
    });
    expect(removed).toBe(true);
  });

  it("does not add while a score job is active", async () => {
    const added: unknown[] = [];
    await enqueueCoalescedScoreJob({
      jobId: scoreRecomputeJobId(PERSON),
      data,
      delayMs: 1,
      getJob: async () => ({
        getState: async () => "active",
        remove: async () => {
          throw new Error("must not remove an active job");
        },
      }),
      add: async () => {
        added.push(1);
      },
    });
    expect(added).toHaveLength(0);
  });
});
