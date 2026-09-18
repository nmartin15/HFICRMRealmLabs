import type { AllocationStage } from "./enums";
import { zonedIsoDate } from "./time";

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

export type CalendarMeetingTaskCandidate = {
  id: string;
  dueAt: string;
};

export type PlanCalendarMeetingTask =
  | { action: "update"; taskId: string; closeDuplicateIds: string[] }
  | { action: "insert"; closeDuplicateIds: string[] };

/**
 * Reuse an open operator meeting on the same local day instead of creating a
 * second leftover task when Calendar later pulls in the same call.
 */
export function planCalendarMeetingTask(input: {
  existingByEventId: { id: string } | null;
  openMeetingsWithoutEvent: CalendarMeetingTaskCandidate[];
  scheduledAt: string;
}): PlanCalendarMeetingTask {
  if (input.existingByEventId) {
    const eventDay = zonedIsoDate(new Date(input.scheduledAt));
    return {
      action: "update",
      taskId: input.existingByEventId.id,
      closeDuplicateIds: input.openMeetingsWithoutEvent
        .filter((task) => zonedIsoDate(new Date(task.dueAt)) === eventDay)
        .map((task) => task.id),
    };
  }

  const eventDay = zonedIsoDate(new Date(input.scheduledAt));
  const sameDay = input.openMeetingsWithoutEvent.filter(
    (task) => zonedIsoDate(new Date(task.dueAt)) === eventDay,
  );
  if (sameDay.length === 0) {
    return { action: "insert", closeDuplicateIds: [] };
  }

  const scheduledMs = new Date(input.scheduledAt).getTime();
  const attached = [...sameDay].sort(
    (a, b) =>
      Math.abs(new Date(a.dueAt).getTime() - scheduledMs) -
      Math.abs(new Date(b.dueAt).getTime() - scheduledMs),
  )[0];
  if (!attached) {
    return { action: "insert", closeDuplicateIds: [] };
  }

  return {
    action: "update",
    taskId: attached.id,
    closeDuplicateIds: sameDay
      .filter((task) => task.id !== attached.id)
      .map((task) => task.id),
  };
}
