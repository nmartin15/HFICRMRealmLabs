import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  decide,
  defaultNurtureFollowUpAt,
  type DecideInput,
} from "./routing";

const CARD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TODAY = "2026-08-24";

function input(overrides: Partial<DecideInput> & Pick<DecideInput, "decision">): DecideInput {
  return {
    cardId: CARD_ID,
    hasIncubatorCard: false,
    today: TODAY,
    ...overrides,
  };
}

describe("decide allocate", () => {
  it("sets stage allocated and does not create an incubator card", () => {
    expect(decide(input({ decision: "allocate" }))).toEqual({
      ok: true,
      allocation: {
        stage: "allocated",
        decision: "allocate",
        passReason: null,
        nurtureFollowUpAt: null,
      },
      person: null,
      incubator: null,
    });
  });
});

describe("decide route_incubator", () => {
  it("keeps allocation stage as decision and creates a routed incubator card", () => {
    expect(
      decide(
        input({
          decision: "route_incubator",
          routingDetail: "strong operator",
        }),
      ),
    ).toEqual({
      ok: true,
      allocation: {
        stage: "decision",
        decision: "route_incubator",
        passReason: null,
        nurtureFollowUpAt: null,
      },
      person: null,
      incubator: {
        stage: "routed",
        tier: null,
        priceUsd: null,
        routingDetail: "strong operator",
      },
    });
  });

  it("defaults price_usd from tiers.ts for non-tier_3", () => {
    expect(decide(input({ decision: "route_incubator", tier: "tier_1" }))).toMatchObject({
      ok: true,
      incubator: { tier: "tier_1", priceUsd: 5000 },
    });
    expect(decide(input({ decision: "route_incubator", tier: "tier_2" }))).toMatchObject({
      ok: true,
      incubator: { tier: "tier_2", priceUsd: 10000 },
    });
    expect(decide(input({ decision: "route_incubator", tier: "tier_4" }))).toMatchObject({
      ok: true,
      incubator: { tier: "tier_4", priceUsd: 100000 },
    });
  });

  it("requires price_usd for tier_3", () => {
    expect(decide(input({ decision: "route_incubator", tier: "tier_3" }))).toEqual({
      ok: false,
      status: 400,
      code: "TIER_3_PRICE_REQUIRED",
      message: "tier_3 requires priceUsd between 25000 and 50000",
    });
  });

  it("rejects tier_3 prices outside 25000–50000", () => {
    expect(
      decide(input({ decision: "route_incubator", tier: "tier_3", priceUsd: 24999 })),
    ).toMatchObject({ ok: false, status: 400, code: "TIER_3_PRICE_INVALID" });
    expect(
      decide(input({ decision: "route_incubator", tier: "tier_3", priceUsd: 50001 })),
    ).toMatchObject({ ok: false, status: 400, code: "TIER_3_PRICE_INVALID" });
  });

  it("accepts tier_3 prices on the inclusive bounds", () => {
    expect(
      decide(input({ decision: "route_incubator", tier: "tier_3", priceUsd: 25000 })),
    ).toMatchObject({ ok: true, incubator: { priceUsd: 25000 } });
    expect(
      decide(input({ decision: "route_incubator", tier: "tier_3", priceUsd: 50000 })),
    ).toMatchObject({ ok: true, incubator: { priceUsd: 50000 } });
    expect(
      decide(input({ decision: "route_incubator", tier: "tier_3", priceUsd: 30000 })),
    ).toMatchObject({ ok: true, incubator: { priceUsd: 30000 } });
  });

  it("returns 409 when routing a person who already has an incubator card", () => {
    expect(
      decide(
        input({
          decision: "route_incubator",
          hasIncubatorCard: true,
          tier: "tier_1",
        }),
      ),
    ).toEqual({
      ok: false,
      status: 409,
      code: "INCUBATOR_EXISTS",
      message: "Person already has an incubator card",
    });
  });
});

describe("decide pass", () => {
  it("requires pass_reason when doNotContact is true", () => {
    expect(
      decide(input({ decision: "pass", doNotContact: true })),
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "PASS_REASON_REQUIRED",
    });
    expect(
      decide(input({ decision: "pass", doNotContact: true, passReason: "   " })),
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "PASS_REASON_REQUIRED",
    });
  });

  it("sets passed and do_not_contact when doNotContact is true", () => {
    expect(
      decide(
        input({
          decision: "pass",
          doNotContact: true,
          passReason: "asked not to be contacted",
          nurture: true,
        }),
      ),
    ).toEqual({
      ok: true,
      allocation: {
        stage: "passed",
        decision: "pass",
        passReason: "asked not to be contacted",
        nurtureFollowUpAt: null,
      },
      person: { doNotContact: true },
      incubator: null,
    });
  });

  it("defaults nurture to true and follow-up to today plus 90 days", () => {
    expect(decide(input({ decision: "pass" }))).toEqual({
      ok: true,
      allocation: {
        stage: "nurture",
        decision: "pass",
        passReason: null,
        nurtureFollowUpAt: defaultNurtureFollowUpAt(TODAY),
      },
      person: null,
      incubator: null,
    });
    expect(defaultNurtureFollowUpAt(TODAY)).toBe("2026-11-22");
  });

  it("uses the provided nurture_follow_up_at when nurturing", () => {
    expect(
      decide(
        input({
          decision: "pass",
          doNotContact: false,
          nurture: true,
          nurtureFollowUpAt: "2026-12-01",
        }),
      ),
    ).toMatchObject({
      ok: true,
      allocation: {
        stage: "nurture",
        nurtureFollowUpAt: "2026-12-01",
      },
    });
  });

  it("sets passed when doNotContact is false and nurture is false", () => {
    expect(
      decide(
        input({
          decision: "pass",
          doNotContact: false,
          nurture: false,
        }),
      ),
    ).toEqual({
      ok: true,
      allocation: {
        stage: "passed",
        decision: "pass",
        passReason: null,
        nurtureFollowUpAt: null,
      },
      person: null,
      incubator: null,
    });
  });
});

describe("nurture follow-up date math", () => {
  it("adds calendar days across month boundaries", () => {
    expect(addCalendarDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addCalendarDays("2026-08-24", 90)).toBe("2026-11-22");
  });
});
