import { describe, expect, it } from "vitest";
import {
  canEnterApplicationSent,
  evaluateIncubatorMove,
  incubatorBoardTotals,
  incubatorColumnValue,
  incubatorPipelineValue,
  INCUBATOR_STAGE_WEIGHTS,
  isIncubatorOpenStage,
  type IncubatorMoveInput,
} from "./incubator";

const base: IncubatorMoveInput = {
  from: "routed",
  to: "routed",
  budgetQualified: "unknown",
  noCallAppLink: false,
  applicationRef: null,
  tier: null,
  priceUsd: null,
};

describe("incubator open stages", () => {
  it("treats Routed through Enrolled as open columns", () => {
    expect(isIncubatorOpenStage("routed")).toBe(true);
    expect(isIncubatorOpenStage("application_sent")).toBe(true);
    expect(isIncubatorOpenStage("application_received")).toBe(true);
    expect(isIncubatorOpenStage("offer_made")).toBe(true);
    expect(isIncubatorOpenStage("paid")).toBe(true);
    expect(isIncubatorOpenStage("enrolled")).toBe(true);
    expect(isIncubatorOpenStage("closed")).toBe(false);
  });
});

describe("application sent gate", () => {
  it("allows budget qualified or no-call app link", () => {
    expect(
      canEnterApplicationSent({
        budgetQualified: "yes",
        noCallAppLink: false,
      }),
    ).toBe(true);
    expect(
      canEnterApplicationSent({
        budgetQualified: "no",
        noCallAppLink: true,
      }),
    ).toBe(true);
    expect(
      canEnterApplicationSent({
        budgetQualified: "unknown",
        noCallAppLink: false,
      }),
    ).toBe(false);
  });

  it("blocks routed to application_sent without budget or no-call link", () => {
    expect(
      evaluateIncubatorMove({ ...base, to: "application_sent" }),
    ).toEqual({
      ok: false,
      status: 400,
      code: "BUDGET_OR_NO_CALL_REQUIRED",
      message:
        "Move to Application Sent requires budget qualified or an app link sent without a call",
    });
  });

  it("allows the move when budget is yes", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        budgetQualified: "yes",
        to: "application_sent",
      }),
    ).toMatchObject({ ok: true, stage: "application_sent" });
  });

  it("allows the move when no_call_app_link is true", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        noCallAppLink: true,
        to: "application_sent",
      }),
    ).toMatchObject({ ok: true, stage: "application_sent" });
  });
});

describe("application received gate", () => {
  it("requires application_ref", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "application_sent",
        to: "application_received",
      }),
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "APPLICATION_REF_REQUIRED",
    });
  });

  it("accepts an existing application_ref", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "application_sent",
        to: "application_received",
        applicationRef: "APP-1",
      }),
    ).toMatchObject({
      ok: true,
      stage: "application_received",
      applicationRef: "APP-1",
    });
  });

  it("accepts application_ref supplied on the move", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "application_sent",
        to: "application_received",
        nextApplicationRef: "  APP-9  ",
      }),
    ).toMatchObject({
      ok: true,
      applicationRef: "APP-9",
    });
  });
});

describe("offer made gate", () => {
  it("requires tier and price", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "application_received",
        to: "offer_made",
      }),
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "TIER_AND_PRICE_REQUIRED",
    });
  });

  it("defaults price from tiers.ts for non-tier_3", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "application_received",
        to: "offer_made",
        nextTier: "tier_2",
      }),
    ).toMatchObject({
      ok: true,
      stage: "offer_made",
      tier: "tier_2",
      priceUsd: 10000,
    });
  });

  it("lets routing tier be overridden at offer", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "application_received",
        to: "offer_made",
        tier: "tier_1",
        priceUsd: 5000,
        nextTier: "tier_4",
      }),
    ).toMatchObject({
      ok: true,
      tier: "tier_4",
      priceUsd: 100000,
    });
  });

  it("requires a tier_3 price between 25000 and 50000", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "application_received",
        to: "offer_made",
        nextTier: "tier_3",
      }),
    ).toMatchObject({ ok: false, code: "TIER_3_PRICE_REQUIRED" });
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "application_received",
        to: "offer_made",
        nextTier: "tier_3",
        nextPriceUsd: 24999,
      }),
    ).toMatchObject({ ok: false, code: "TIER_3_PRICE_INVALID" });
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "application_received",
        to: "offer_made",
        nextTier: "tier_3",
        nextPriceUsd: 30000,
      }),
    ).toMatchObject({ ok: true, priceUsd: 30000, tier: "tier_3" });
  });
});

describe("paid gate", () => {
  it("requires confirmation for a manual paid move", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "offer_made",
        to: "paid",
        tier: "tier_1",
        priceUsd: 5000,
      }),
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "PAID_CONFIRMATION_REQUIRED",
    });
  });

  it("allows paid after confirmation", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "offer_made",
        to: "paid",
        confirmPaid: true,
        tier: "tier_1",
        priceUsd: 5000,
      }),
    ).toMatchObject({ ok: true, stage: "paid" });
  });
});

describe("closed gate", () => {
  it("requires close_reason from any open stage", () => {
    expect(
      evaluateIncubatorMove({ ...base, to: "closed" }),
    ).toMatchObject({ ok: false, code: "CLOSE_REASON_REQUIRED" });
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "enrolled",
        to: "closed",
        closeReason: "  withdrew  ",
      }),
    ).toEqual({
      ok: true,
      stage: "closed",
      applicationRef: null,
      tier: null,
      priceUsd: null,
      closeReason: "withdrew",
      closed: true,
    });
  });

  it("rejects moving a closed card", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        from: "closed",
        to: "routed",
        closeReason: "withdrew",
      }),
    ).toMatchObject({ ok: false, code: "INVALID_STAGE_MOVE" });
  });
});

describe("pipeline value", () => {
  it("sums price_usd and applies stage weights, ignoring closed", () => {
    expect(INCUBATOR_STAGE_WEIGHTS.routed).toBe(0.1);
    expect(INCUBATOR_STAGE_WEIGHTS.application_sent).toBe(0.25);
    expect(INCUBATOR_STAGE_WEIGHTS.application_received).toBe(0.4);
    expect(INCUBATOR_STAGE_WEIGHTS.offer_made).toBe(0.6);
    expect(INCUBATOR_STAGE_WEIGHTS.paid).toBe(1);
    expect(INCUBATOR_STAGE_WEIGHTS.enrolled).toBe(1);

    const cards = [
      { stage: "routed" as const, priceUsd: 5000 },
      { stage: "application_sent" as const, priceUsd: 10000 },
      { stage: "offer_made" as const, priceUsd: 30000 },
      { stage: "closed" as const, priceUsd: 100000 },
      { stage: "enrolled" as const, priceUsd: null },
    ];
    expect(incubatorPipelineValue(cards)).toEqual({
      total: 45000,
      weighted: 5000 * 0.1 + 10000 * 0.25 + 30000 * 0.6,
    });
    expect(incubatorColumnValue(cards.slice(0, 1))).toEqual({
      count: 1,
      priceUsd: 5000,
    });
    expect(
      incubatorBoardTotals({
        routed: [{ priceUsd: 5000 }],
        application_sent: [{ priceUsd: 10000 }],
        application_received: [],
        offer_made: [{ priceUsd: 30000 }],
        paid: [],
        enrolled: [{ priceUsd: null }],
      }),
    ).toEqual({
      pipelineUsd: 45000,
      weightedUsd: 5000 * 0.1 + 10000 * 0.25 + 30000 * 0.6,
      columns: {
        routed: { count: 1, priceUsd: 5000 },
        application_sent: { count: 1, priceUsd: 10000 },
        application_received: { count: 0, priceUsd: 0 },
        offer_made: { count: 1, priceUsd: 30000 },
        paid: { count: 0, priceUsd: 0 },
        enrolled: { count: 1, priceUsd: 0 },
      },
    });
  });
});
