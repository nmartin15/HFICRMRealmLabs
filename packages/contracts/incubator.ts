import type { BudgetQualified, IncubatorStage, IncubatorTierName } from "./enums";

export const INCUBATOR_OPEN_STAGES = ["sent", "applied", "approved"] as const;
export type IncubatorOpenStage = (typeof INCUBATOR_OPEN_STAGES)[number];

export const INCUBATOR_STAGE_WEIGHTS: Record<IncubatorOpenStage, number> = {
  sent: 0.25,
  applied: 0.4,
  approved: 1.0,
};

export function isIncubatorOpenStage(
  stage: IncubatorStage,
): stage is IncubatorOpenStage {
  return (INCUBATOR_OPEN_STAGES as readonly string[]).includes(stage);
}

export function incubatorTierLabel(tier: IncubatorTierName): string {
  return tier.replace("_", " ");
}

export function isBudgetQualified(value: BudgetQualified): boolean {
  return value === "light" || value === "heavy";
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
  nextApplicationRef?: string;
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
      closed: input.from === "rejected",
    };
  }

  if (input.from === "rejected") {
    return fail(
      "INVALID_STAGE_MOVE",
      "Rejected incubator cards cannot be moved",
    );
  }

  if (input.to === "rejected") {
    const closeReason = trimmed(input.closeReason);
    if (!closeReason) {
      return fail("CLOSE_REASON_REQUIRED", "close_reason is required");
    }
    return {
      ok: true,
      stage: "rejected",
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

  let applicationRef = input.applicationRef;
  if (input.to === "applied") {
    applicationRef = trimmed(input.nextApplicationRef) ?? input.applicationRef;
    if (!applicationRef) {
      return fail(
        "APPLICATION_REF_REQUIRED",
        "application_ref is required to move to Applied",
      );
    }
  }

  return {
    ok: true,
    stage: input.to,
    applicationRef,
    tier: input.tier,
    priceUsd: input.priceUsd,
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
    sent: incubatorColumnValue(columns.sent),
    applied: incubatorColumnValue(columns.applied),
    approved: incubatorColumnValue(columns.approved),
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
