import type { AllocationStage, IncubatorStage } from "./enums";

export const ALLOCATION_OPEN_STAGES = [
  "applied",
  "contacted",
  "in_conversation",
  "decision",
] as const;
export type AllocationOpenStage = (typeof ALLOCATION_OPEN_STAGES)[number];

export const ALLOCATION_CLOSED_STAGES = [
  "allocated",
  "nurture",
  "passed",
] as const;
export type AllocationClosedStage = (typeof ALLOCATION_CLOSED_STAGES)[number];

export const ALLOCATION_STAGE_LABELS: Record<AllocationStage, string> = {
  applied: "Applied",
  contacted: "Contacted",
  in_conversation: "In Conversation",
  decision: "Decision",
  allocated: "Allocated",
  nurture: "Nurture",
  passed: "Passed",
};

export const INCUBATOR_STAGE_LABELS: Record<IncubatorStage, string> = {
  routed: "Routed",
  application_sent: "Application Sent",
  application_received: "Application Received",
  offer_made: "Offer Made",
  paid: "Paid",
  enrolled: "Enrolled",
  closed: "Closed",
};

export const ALLOCATION_BOARD_HREF = "/allocation" as const;
export const INCUBATOR_BOARD_HREF = "/incubator" as const;

const MS_PER_DAY = 86_400_000;

export function isAllocationOpenStage(
  stage: AllocationStage,
): stage is AllocationOpenStage {
  return (ALLOCATION_OPEN_STAGES as readonly string[]).includes(stage);
}

export function isAllocationClosedStage(
  stage: AllocationStage,
): stage is AllocationClosedStage {
  return (ALLOCATION_CLOSED_STAGES as readonly string[]).includes(stage);
}

export function canMoveAllocationStage(
  from: AllocationStage,
  to: AllocationStage,
): boolean {
  return isAllocationOpenStage(from) && isAllocationOpenStage(to);
}

export function canSendAppLinkWithoutCall(stage: AllocationStage): boolean {
  return stage === "contacted";
}

export function daysInStage(enteredAtIso: string, now: Date): number {
  const entered = new Date(enteredAtIso).getTime();
  if (Number.isNaN(entered)) {
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - entered) / MS_PER_DAY));
}

export function stageEnteredAtIso(input: {
  cardCreatedAt: string;
  currentStage: string;
  lastStageChange: { occurredAt: string; afterStage: unknown } | null;
}): string {
  if (
    input.lastStageChange &&
    input.lastStageChange.afterStage === input.currentStage
  ) {
    return input.lastStageChange.occurredAt;
  }
  return input.cardCreatedAt;
}

export type PersonBoardBadge =
  | {
      board: "allocation";
      stage: AllocationStage;
      href: typeof ALLOCATION_BOARD_HREF;
    }
  | {
      board: "incubator";
      stage: IncubatorStage;
      href: typeof INCUBATOR_BOARD_HREF;
    };

export function currentBoardBadge(input: {
  allocationStage: AllocationStage | null;
  incubatorStage: IncubatorStage | null;
}): PersonBoardBadge | null {
  if (input.incubatorStage && input.incubatorStage !== "closed") {
    return {
      board: "incubator",
      stage: input.incubatorStage,
      href: INCUBATOR_BOARD_HREF,
    };
  }
  if (input.allocationStage) {
    return {
      board: "allocation",
      stage: input.allocationStage,
      href: ALLOCATION_BOARD_HREF,
    };
  }
  return null;
}

export function personDisplayName(person: {
  firstName: string;
  lastName: string;
}): string {
  return `${person.firstName} ${person.lastName}`.trim();
}
