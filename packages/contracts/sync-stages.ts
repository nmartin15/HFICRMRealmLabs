import type { AllocationStage } from "./enums";

export function allocationStageOnInboundReply(
  stage: AllocationStage,
): AllocationStage | null {
  if (stage === "applied") {
    return "contacted";
  }
  return null;
}

export function allocationStageOnMeetingCreated(
  stage: AllocationStage,
): AllocationStage | null {
  if (stage === "applied" || stage === "contacted") {
    return "in_conversation";
  }
  return null;
}

export function cancelledMeetingResolution(
  hasReplacement: boolean,
): "rescheduled" | "needs_review" {
  return hasReplacement ? "rescheduled" : "needs_review";
}
