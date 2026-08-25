import { z } from "zod";
import {
  allocationDecisionSchema,
  incubatorTierSchema,
  isoDateSchema,
  uuidSchema,
  type AllocationDecision,
  type AllocationStage,
  type IncubatorTierName,
} from "./enums";
import { DISPLAY_TIME_ZONE } from "./time";
import {
  defaultPriceUsdForTier,
  TIER_3_PRICE_RANGE,
  type IncubatorTier,
} from "./tiers";

export const NURTURE_FOLLOW_UP_DAYS = 90;

export const decideBodySchema = z.object({
  decision: allocationDecisionSchema,
  passReason: z.string().optional(),
  doNotContact: z.boolean().optional(),
  tier: incubatorTierSchema.optional(),
  priceUsd: z.number().int().optional(),
  routingDetail: z.string().optional(),
  nurture: z.boolean().optional(),
  nurtureFollowUpAt: isoDateSchema.optional(),
});
export type DecideBody = z.infer<typeof decideBodySchema>;

export const decideInputSchema = decideBodySchema.extend({
  cardId: uuidSchema,
  hasIncubatorCard: z.boolean(),
  today: isoDateSchema,
});
export type DecideInput = z.infer<typeof decideInputSchema>;

export const nurtureRouteBodySchema = decideBodySchema.omit({
  decision: true,
});
export type NurtureRouteBody = z.infer<typeof nurtureRouteBodySchema>;

export type DecideError = {
  ok: false;
  status: 400 | 409;
  code: string;
  message: string;
};

export type DecideSuccess = {
  ok: true;
  allocation: {
    stage: AllocationStage;
    decision: AllocationDecision;
    passReason: string | null;
    nurtureFollowUpAt: string | null;
  };
  person: { doNotContact: true } | null;
  incubator: {
    stage: "routed";
    tier: IncubatorTierName | null;
    priceUsd: number | null;
    routingDetail: string | null;
  } | null;
};

export type DecideResult = DecideSuccess | DecideError;

function fail(
  status: 400 | 409,
  code: string,
  message: string,
): DecideError {
  return { ok: false, status, code, message };
}

export function addCalendarDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid date: ${isoDate}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function defaultNurtureFollowUpAt(today: string): string {
  return addCalendarDays(today, NURTURE_FOLLOW_UP_DAYS);
}

export function todayIsoInDisplayZone(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
  }).format(now);
}

export function resolveIncubatorPrice(
  tier: IncubatorTierName | undefined,
  priceUsd: number | undefined,
): { ok: true; priceUsd: number | null } | DecideError {
  if (!tier) {
    return { ok: true, priceUsd: priceUsd ?? null };
  }
  if (tier === "tier_3") {
    if (priceUsd === undefined) {
      return fail(
        400,
        "TIER_3_PRICE_REQUIRED",
        "tier_3 requires priceUsd between 25000 and 50000",
      );
    }
    if (
      priceUsd < TIER_3_PRICE_RANGE.min ||
      priceUsd > TIER_3_PRICE_RANGE.max
    ) {
      return fail(
        400,
        "TIER_3_PRICE_INVALID",
        "tier_3 priceUsd must be between 25000 and 50000",
      );
    }
    return { ok: true, priceUsd };
  }
  return {
    ok: true,
    priceUsd: priceUsd ?? defaultPriceUsdForTier(tier as IncubatorTier),
  };
}

function trimmed(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const next = value.trim();
  return next.length > 0 ? next : null;
}

export function decide(input: DecideInput): DecideResult {
  if (input.decision === "route_incubator" && input.hasIncubatorCard) {
    return fail(
      409,
      "INCUBATOR_EXISTS",
      "Person already has an incubator card",
    );
  }

  if (input.decision === "allocate") {
    return {
      ok: true,
      allocation: {
        stage: "allocated",
        decision: "allocate",
        passReason: null,
        nurtureFollowUpAt: null,
      },
      person: null,
      incubator: null,
    };
  }

  if (input.decision === "route_incubator") {
    const price = resolveIncubatorPrice(input.tier, input.priceUsd);
    if (!price.ok) {
      return price;
    }
    return {
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
        tier: input.tier ?? null,
        priceUsd: price.priceUsd,
        routingDetail: trimmed(input.routingDetail),
      },
    };
  }

  const doNotContact = input.doNotContact === true;
  const passReason = trimmed(input.passReason);

  if (doNotContact) {
    if (!passReason) {
      return fail(
        400,
        "PASS_REASON_REQUIRED",
        "pass_reason is required when doNotContact is true",
      );
    }
    return {
      ok: true,
      allocation: {
        stage: "passed",
        decision: "pass",
        passReason,
        nurtureFollowUpAt: null,
      },
      person: { doNotContact: true },
      incubator: null,
    };
  }

  const nurture = input.nurture !== false;
  if (nurture) {
    return {
      ok: true,
      allocation: {
        stage: "nurture",
        decision: "pass",
        passReason,
        nurtureFollowUpAt:
          input.nurtureFollowUpAt ?? defaultNurtureFollowUpAt(input.today),
      },
      person: null,
      incubator: null,
    };
  }

  return {
    ok: true,
    allocation: {
      stage: "passed",
      decision: "pass",
      passReason,
      nurtureFollowUpAt: null,
    },
    person: null,
    incubator: null,
  };
}

export function canReopenFromNurture(stage: AllocationStage): boolean {
  return stage === "nurture";
}

export function isOnAllocationBoard(decision: AllocationDecision | null): boolean {
  return decision !== "route_incubator";
}
