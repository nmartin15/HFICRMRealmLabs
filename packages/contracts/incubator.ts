import type { BudgetQualified, IncubatorStage, IncubatorTierName } from "./enums";
import { resolveIncubatorPrice } from "./routing";

export const INCUBATOR_OPEN_STAGES = [
  "routed",
  "application_sent",
  "application_received",
  "offer_made",
  "paid",
  "enrolled",
] as const;
export type IncubatorOpenStage = (typeof INCUBATOR_OPEN_STAGES)[number];

export const INCUBATOR_STAGE_WEIGHTS: Record<IncubatorOpenStage, number> = {
  routed: 0.1,
  application_sent: 0.25,
  application_received: 0.4,
  offer_made: 0.6,
  paid: 1.0,
  enrolled: 1.0,
};

export function isIncubatorOpenStage(
  stage: IncubatorStage,
): stage is IncubatorOpenStage {
  return (INCUBATOR_OPEN_STAGES as readonly string[]).includes(stage);
}

export function incubatorTierLabel(tier: IncubatorTierName): string {
  return tier.replace("_", " ");
}

export function canEnterApplicationSent(input: {
  budgetQualified: BudgetQualified;
  noCallAppLink: boolean;
}): boolean {
  return input.budgetQualified === "yes" || input.noCallAppLink;
}

export type IncubatorMoveInput = {
  from: IncubatorStage;
  to: IncubatorStage;
  budgetQualified: BudgetQualified;
  noCallAppLink: boolean;
  applicationRef: string | null;
  tier: IncubatorTierName | null;
  priceUsd: number | null;
  closeReason?: string;
  confirmPaid?: boolean;
  nextApplicationRef?: string;
  nextTier?: IncubatorTierName;
  nextPriceUsd?: number;
};

export type IncubatorMoveError = {
  ok: false;
  status: 400;
  code: string;
  message: string;
};

export type IncubatorMoveSuccess = {
  ok: true;
  stage: IncubatorStage;
  applicationRef: string | null;
  tier: IncubatorTierName | null;
  priceUsd: number | null;
  closeReason: string | null;
  closed: boolean;
};

export type IncubatorMoveResult = IncubatorMoveSuccess | IncubatorMoveError;

function fail(code: string, message: string): IncubatorMoveError {
  return { ok: false, status: 400, code, message };
}

function trimmed(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const next = value.trim();
  return next.length > 0 ? next : null;
}

export function evaluateIncubatorMove(
  input: IncubatorMoveInput,
): IncubatorMoveResult {
  if (input.from === input.to) {
    return {
      ok: true,
      stage: input.from,
      applicationRef: input.applicationRef,
      tier: input.tier,
      priceUsd: input.priceUsd,
      closeReason: input.closeReason ? trimmed(input.closeReason) : null,
      closed: input.from === "closed",
    };
  }

  if (input.from === "closed") {
    return fail(
      "INVALID_STAGE_MOVE",
      "Closed incubator cards cannot be moved",
    );
  }

  if (input.to === "closed") {
    const closeReason = trimmed(input.closeReason);
    if (!closeReason) {
      return fail("CLOSE_REASON_REQUIRED", "close_reason is required");
    }
    return {
      ok: true,
      stage: "closed",
      applicationRef: input.applicationRef,
      tier: input.tier,
      priceUsd: input.priceUsd,
      closeReason,
      closed: true,
    };
  }

  if (!isIncubatorOpenStage(input.to)) {
    return fail("INVALID_STAGE_MOVE", "Unknown incubator stage");
  }

  if (input.to === "application_sent") {
    if (
      !canEnterApplicationSent({
        budgetQualified: input.budgetQualified,
        noCallAppLink: input.noCallAppLink,
      })
    ) {
      return fail(
        "BUDGET_OR_NO_CALL_REQUIRED",
        "Move to Application Sent requires budget qualified or an app link sent without a call",
      );
    }
  }

  let applicationRef = input.applicationRef;
  if (input.to === "application_received") {
    applicationRef = trimmed(input.nextApplicationRef) ?? input.applicationRef;
    if (!applicationRef) {
      return fail(
        "APPLICATION_REF_REQUIRED",
        "application_ref is required to move to Application Received",
      );
    }
  }

  let tier = input.tier;
  let priceUsd = input.priceUsd;
  if (input.to === "offer_made") {
    const nextTier = input.nextTier ?? input.tier ?? undefined;
    if (!nextTier) {
      return fail(
        "TIER_AND_PRICE_REQUIRED",
        "tier and price_usd are required to move to Offer Made",
      );
    }
    const nextPrice =
      input.nextPriceUsd !== undefined
        ? input.nextPriceUsd
        : input.nextTier !== undefined
          ? undefined
          : (input.priceUsd ?? undefined);
    const price = resolveIncubatorPrice(nextTier, nextPrice);
    if (!price.ok) {
      return fail(price.code, price.message);
    }
    if (price.priceUsd === null) {
      return fail(
        "TIER_AND_PRICE_REQUIRED",
        "tier and price_usd are required to move to Offer Made",
      );
    }
    tier = nextTier;
    priceUsd = price.priceUsd;
  }

  if (input.to === "paid" && input.confirmPaid !== true) {
    return fail(
      "PAID_CONFIRMATION_REQUIRED",
      "Marking Paid requires confirmation",
    );
  }

  return {
    ok: true,
    stage: input.to,
    applicationRef,
    tier,
    priceUsd,
    closeReason: null,
    closed: false,
  };
}

export type IncubatorPricedCard = {
  stage: IncubatorStage;
  priceUsd: number | null;
};

export function sumPriceUsd(prices: Array<number | null | undefined>): number {
  return prices.reduce<number>((sum, price) => sum + (price ?? 0), 0);
}

export function incubatorColumnValue(
  cards: Array<{ priceUsd: number | null }>,
): { count: number; priceUsd: number } {
  return {
    count: cards.length,
    priceUsd: sumPriceUsd(cards.map((card) => card.priceUsd)),
  };
}

export function incubatorPipelineValue(cards: IncubatorPricedCard[]): {
  total: number;
  weighted: number;
} {
  let total = 0;
  let weighted = 0;
  for (const card of cards) {
    if (!isIncubatorOpenStage(card.stage)) {
      continue;
    }
    const price = card.priceUsd ?? 0;
    total += price;
    weighted += price * INCUBATOR_STAGE_WEIGHTS[card.stage];
  }
  return { total, weighted };
}

export function incubatorBoardTotals(
  columns: Record<IncubatorOpenStage, Array<{ priceUsd: number | null }>>,
): {
  pipelineUsd: number;
  weightedUsd: number;
  columns: Record<IncubatorOpenStage, { count: number; priceUsd: number }>;
} {
  const columnStats = {
    routed: incubatorColumnValue(columns.routed),
    application_sent: incubatorColumnValue(columns.application_sent),
    application_received: incubatorColumnValue(columns.application_received),
    offer_made: incubatorColumnValue(columns.offer_made),
    paid: incubatorColumnValue(columns.paid),
    enrolled: incubatorColumnValue(columns.enrolled),
  };
  const pipeline = incubatorPipelineValue(
    INCUBATOR_OPEN_STAGES.flatMap((stage) =>
      columns[stage].map((card) => ({
        stage,
        priceUsd: card.priceUsd,
      })),
    ),
  );
  return {
    pipelineUsd: pipeline.total,
    weightedUsd: pipeline.weighted,
    columns: columnStats,
  };
}
