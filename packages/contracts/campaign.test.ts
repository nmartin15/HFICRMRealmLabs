import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_MOVE_POLICY,
  CAMPAIGN_PROGRAM_STAGE_CHURN_WINDOW_MS,
  CAMPAIGN_PROGRAM_STAGE_START_LIMIT,
  campaignMoveKind,
  formatCampaignTag,
  parseCampaignTag,
  planCampaignSequence,
  resolveCampaignTag,
  staleCampaignAsOf,
  staleCampaignPayload,
  type CampaignSequenceMemory,
  type ResolvedCampaignTag,
} from "./campaign";

function sequenceMemory(
  partial: Omit<
    CampaignSequenceMemory,
    "programStageStartCount" | "programStageStartWindowAt"
  > &
    Partial<
      Pick<
        CampaignSequenceMemory,
        "programStageStartCount" | "programStageStartWindowAt"
      >
    >,
): CampaignSequenceMemory {
  return {
    programStageStartCount: 0,
    programStageStartWindowAt: null,
    ...partial,
  };
}

function salesTag(input: {
  bucket: "cold" | "lukewarm" | "warm" | "hot";
  stage: string;
}): ResolvedCampaignTag {
  const resolved = resolveCampaignTag({
    bucket: input.bucket,
    programTrack: "allocation",
    stage: input.stage,
    suppressionReason: null,
    stayInTouch: false,
    doNotContact: false,
    newsletterGranted: false,
  });
  if (!resolved) {
    throw new Error("expected a sales tag");
  }
  return resolved;
}

describe("campaign tags", () => {
  it("formats a stable parseable tag", () => {
    const tag = formatCampaignTag({
      lane: "sales",
      program: "allocation",
      stage: "contacted",
      intensity: "warm",
    });
    expect(tag).toBe("rl.v1.sales.allocation.contacted.warm");
    expect(parseCampaignTag(tag)).toEqual({
      version: "v1",
      lane: "sales",
      program: "allocation",
      stage: "contacted",
      intensity: "warm",
    });
  });

  it("tags from the hysteresis campaign bucket, not raw enter or a display remap", () => {
    const warmAt79 = resolveCampaignTag({
      bucket: "warm",
      programTrack: "incubator",
      stage: "applied",
      suppressionReason: null,
      stayInTouch: false,
      doNotContact: false,
      newsletterGranted: false,
    });
    expect(warmAt79?.tag).toBe("rl.v1.sales.incubator.applied.warm");
    expect(warmAt79?.intensity).toBe("warm");

    const heldHotAt79 = resolveCampaignTag({
      bucket: "hot",
      programTrack: "incubator",
      stage: "applied",
      suppressionReason: null,
      stayInTouch: false,
      doNotContact: false,
      newsletterGranted: false,
    });
    expect(heldHotAt79?.intensity).toBe("hot");
  });

  it("forces the softest sequence when program is unknown, regardless of bucket", () => {
    const resolved = resolveCampaignTag({
      bucket: "hot",
      programTrack: null,
      stage: null,
      suppressionReason: null,
      stayInTouch: false,
      doNotContact: false,
      newsletterGranted: false,
    });
    expect(resolved?.tag).toBe("rl.v1.sales.unknown.none.soft");
    expect(resolved?.intensity).toBe("soft");
  });

  it("gives suppressed contacts no tag", () => {
    expect(
      resolveCampaignTag({
        bucket: "warm",
        programTrack: "allocation",
        stage: "contacted",
        suppressionReason: "unsubscribed",
        stayInTouch: false,
        doNotContact: false,
        newsletterGranted: true,
      }),
    ).toBeNull();
    expect(
      resolveCampaignTag({
        bucket: "warm",
        programTrack: "allocation",
        stage: "contacted",
        suppressionReason: null,
        stayInTouch: false,
        doNotContact: true,
        newsletterGranted: false,
      }),
    ).toBeNull();
  });

  it("gives recruiter contacts no tag, including newsletter", () => {
    expect(
      resolveCampaignTag({
        bucket: "hot",
        programTrack: "allocation",
        stage: "contacted",
        suppressionReason: null,
        stayInTouch: false,
        doNotContact: false,
        newsletterGranted: true,
        contactKind: "recruiter",
      }),
    ).toBeNull();
  });

  it("limits rejected-but-interested contacts to newsletter when consented", () => {
    expect(
      resolveCampaignTag({
        bucket: "warm",
        programTrack: "allocation",
        stage: "passed",
        suppressionReason: "rejected",
        stayInTouch: false,
        doNotContact: false,
        newsletterGranted: false,
      }),
    ).toBeNull();
    expect(
      resolveCampaignTag({
        bucket: "hot",
        programTrack: "allocation",
        stage: "passed",
        suppressionReason: "rejected",
        stayInTouch: false,
        doNotContact: false,
        newsletterGranted: true,
      })?.tag,
    ).toBe("rl.v1.newsletter.none.none.none");
  });

  it("maps up to start and down to stop from the editable policy table", () => {
    expect(CAMPAIGN_MOVE_POLICY.up).toBe("start");
    expect(CAMPAIGN_MOVE_POLICY.down).toBe("stop");
    expect(campaignMoveKind("warm", "hot")).toBe("up");
    expect(campaignMoveKind("hot", "warm")).toBe("down");
    expect(
      planCampaignSequence({
        previous: sequenceMemory({
          tag: "rl.v1.sales.allocation.contacted.warm",
          intensity: "warm",
          programStageKey: "allocation:contacted",
          lastSequenceStartAt: 0,
          lastStartProgramStageKey: "allocation:contacted",
        }),
        next: salesTag({ bucket: "hot", stage: "contacted" }),
        asOf: 1,
      }).action,
    ).toBe("pending_review");
    expect(
      planCampaignSequence({
        previous: sequenceMemory({
          tag: "rl.v1.sales.allocation.contacted.hot",
          intensity: "hot",
          programStageKey: "allocation:contacted",
          lastSequenceStartAt: 0,
          lastStartProgramStageKey: "allocation:contacted",
        }),
        next: salesTag({ bucket: "warm", stage: "contacted" }),
        asOf: 1,
      }).action,
    ).toBe("stop");
  });

  it("does not rate-limit bucket-only upgrades, and holds the third program/stage start in a week", () => {
    const asOf = CAMPAIGN_PROGRAM_STAGE_CHURN_WINDOW_MS - 1;
    const bucketOnly = planCampaignSequence({
      previous: sequenceMemory({
        tag: "rl.v1.sales.allocation.contacted.lukewarm",
        intensity: "lukewarm",
        programStageKey: "allocation:contacted",
        lastSequenceStartAt: 0,
        lastStartProgramStageKey: "allocation:contacted",
        programStageStartCount: 2,
        programStageStartWindowAt: 0,
      }),
      next: salesTag({ bucket: "warm", stage: "contacted" }),
      asOf,
    });
    expect(bucketOnly.action).toBe("start");
    expect(bucketOnly.programStageChurnHeld).toBe(false);
    expect(bucketOnly.programStageStartCount).toBe(2);

    const firstStage = planCampaignSequence({
      previous: sequenceMemory({
        tag: "rl.v1.sales.allocation.applied.cold",
        intensity: "cold",
        programStageKey: "allocation:applied",
        lastSequenceStartAt: 0,
        lastStartProgramStageKey: "allocation:applied",
      }),
      next: salesTag({ bucket: "cold", stage: "contacted" }),
      asOf,
    });
    expect(firstStage.action).toBe("start");
    expect(firstStage.programStageChurnHeld).toBe(false);
    expect(firstStage.programStageStartCount).toBe(1);

    const secondStage = planCampaignSequence({
      previous: sequenceMemory({
        tag: firstStage.tag,
        intensity: firstStage.intensity,
        programStageKey: firstStage.programStageKey,
        lastSequenceStartAt: firstStage.lastSequenceStartAt,
        lastStartProgramStageKey: firstStage.lastStartProgramStageKey,
        programStageStartCount: firstStage.programStageStartCount,
        programStageStartWindowAt: firstStage.programStageStartWindowAt,
      }),
      next: salesTag({ bucket: "cold", stage: "in_conversation" }),
      asOf,
    });
    expect(secondStage.action).toBe("start");
    expect(secondStage.programStageChurnHeld).toBe(false);
    expect(secondStage.programStageStartCount).toBe(
      CAMPAIGN_PROGRAM_STAGE_START_LIMIT,
    );

    const thirdStage = planCampaignSequence({
      previous: sequenceMemory({
        tag: secondStage.tag,
        intensity: secondStage.intensity,
        programStageKey: secondStage.programStageKey,
        lastSequenceStartAt: secondStage.lastSequenceStartAt,
        lastStartProgramStageKey: secondStage.lastStartProgramStageKey,
        programStageStartCount: secondStage.programStageStartCount,
        programStageStartWindowAt: secondStage.programStageStartWindowAt,
      }),
      next: salesTag({ bucket: "cold", stage: "decision" }),
      asOf,
    });
    expect(thirdStage.action).toBe("hold");
    expect(thirdStage.programStageChurnHeld).toBe(true);
    expect(thirdStage.programStageStartCount).toBe(
      CAMPAIGN_PROGRAM_STAGE_START_LIMIT,
    );

    const afterWindow = planCampaignSequence({
      previous: sequenceMemory({
        tag: thirdStage.tag,
        intensity: thirdStage.intensity,
        programStageKey: thirdStage.programStageKey,
        lastSequenceStartAt: thirdStage.lastSequenceStartAt,
        lastStartProgramStageKey: thirdStage.lastStartProgramStageKey,
        programStageStartCount: thirdStage.programStageStartCount,
        programStageStartWindowAt: thirdStage.programStageStartWindowAt,
      }),
      next: salesTag({ bucket: "cold", stage: "contacted" }),
      asOf:
        (thirdStage.programStageStartWindowAt ?? 0) +
        CAMPAIGN_PROGRAM_STAGE_CHURN_WINDOW_MS,
    });
    expect(afterWindow.action).toBe("start");
    expect(afterWindow.programStageChurnHeld).toBe(false);
    expect(afterWindow.programStageStartCount).toBe(1);
  });

  it("rejects stale payloads by revision", () => {
    expect(staleCampaignPayload(3, 5)).toBe(true);
    expect(staleCampaignPayload(5, 5)).toBe(false);
    expect(staleCampaignAsOf(1, 2)).toBe(true);
    expect(staleCampaignAsOf(2, 2)).toBe(false);
    expect(staleCampaignAsOf(3, 2)).toBe(false);
  });
});
