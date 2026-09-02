import type {
  AllocationStage,
  BudgetQualified,
  IncubatorStage,
  LeadTemp,
  ProgramTrack,
} from "./enums";

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
  sent: "Sent",
  applied: "Applied",
  approved: "Approved",
  rejected: "Rejected",
};

export const PROGRAM_TRACK_LABELS: Record<ProgramTrack, string> = {
  allocation: "Allocation",
  incubator: "Incubator",
  recruitment: "Recruitment",
  capital_raising: "Capital Raising",
};

export const BUDGET_QUALIFIED_LABELS: Record<BudgetQualified, string> = {
  light: "Light",
  heavy: "Heavy",
  not_qualified: "False",
  unknown: "Unknown",
};

export const LEAD_TEMP_LABELS: Record<LeadTemp, string> = {
  cold: "Cold",
  lukewarm: "Lukewarm",
  warm: "Warm",
  hot: "Hot",
};

export const ALLOCATION_BOARD_HREF = "/allocation" as const;
export const INCUBATOR_BOARD_HREF = "/incubator" as const;
export const RECRUITMENT_BOARD_HREF = "/recruitment" as const;
export const CAPITAL_RAISING_BOARD_HREF = "/capital-raising" as const;

export const PIPELINE_BOARD_TRACKS = [
  "allocation",
  "recruitment",
  "capital_raising",
] as const;
export type PipelineBoardTrack = (typeof PIPELINE_BOARD_TRACKS)[number];

export const PIPELINE_BOARD_HREFS: Record<
  PipelineBoardTrack,
  "/allocation" | "/recruitment" | "/capital-raising"
> = {
  allocation: ALLOCATION_BOARD_HREF,
  recruitment: RECRUITMENT_BOARD_HREF,
  capital_raising: CAPITAL_RAISING_BOARD_HREF,
};

export function isPipelineBoardTrack(
  track: ProgramTrack | null | undefined,
): track is PipelineBoardTrack {
  return (
    track === "allocation" ||
    track === "recruitment" ||
    track === "capital_raising"
  );
}

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
      board: PipelineBoardTrack;
      stage: AllocationStage;
      href: (typeof PIPELINE_BOARD_HREFS)[PipelineBoardTrack];
    }
  | {
      board: "incubator";
      stage: IncubatorStage;
      href: typeof INCUBATOR_BOARD_HREF;
    };

export function currentBoardBadge(input: {
  programTrack: ProgramTrack | null;
  doNotContact: boolean;
  allocationStage: AllocationStage | null;
  incubatorStage: IncubatorStage | null;
}): PersonBoardBadge | null {
  if (input.doNotContact) {
    return null;
  }
  if (input.programTrack === "incubator" && input.incubatorStage) {
    return {
      board: "incubator",
      stage: input.incubatorStage,
      href: INCUBATOR_BOARD_HREF,
    };
  }
  if (
    isPipelineBoardTrack(input.programTrack) &&
    input.allocationStage
  ) {
    return {
      board: input.programTrack,
      stage: input.allocationStage,
      href: PIPELINE_BOARD_HREFS[input.programTrack],
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
