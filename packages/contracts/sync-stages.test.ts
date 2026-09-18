import { describe, expect, it } from "vitest";
import {
  allocationStageOnInboundReply,
  allocationStageOnMeetingCreated,
  cancelledMeetingResolution,
  planCalendarMeetingTask,
} from "./sync-stages";
import type { AllocationStage } from "./enums";

const stages: AllocationStage[] = [
  "applied",
  "contacted",
  "in_conversation",
  "decision",
  "allocated",
  "nurture",
  "passed",
];

describe("automatic stage moves", () => {
  it("moves Applied to Contacted on first inbound reply", () => {
    expect(allocationStageOnInboundReply("applied")).toBe("contacted");
  });

  it("does not move any other stage on inbound reply", () => {
    for (const stage of stages) {
      if (stage === "applied") {
        continue;
      }
      expect(allocationStageOnInboundReply(stage)).toBeNull();
    }
  });

  it("moves Applied or Contacted to In Conversation when a meeting is created", () => {
    expect(allocationStageOnMeetingCreated("applied")).toBe("in_conversation");
    expect(allocationStageOnMeetingCreated("contacted")).toBe(
      "in_conversation",
    );
  });

  it("does not move later stages when a meeting is created", () => {
    expect(allocationStageOnMeetingCreated("in_conversation")).toBeNull();
    expect(allocationStageOnMeetingCreated("decision")).toBeNull();
    expect(allocationStageOnMeetingCreated("allocated")).toBeNull();
    expect(allocationStageOnMeetingCreated("nurture")).toBeNull();
    expect(allocationStageOnMeetingCreated("passed")).toBeNull();
  });

  it("marks a cancelled meeting rescheduled only when a replacement exists", () => {
    expect(cancelledMeetingResolution(true)).toBe("rescheduled");
    expect(cancelledMeetingResolution(false)).toBe("needs_review");
  });
});

describe("planCalendarMeetingTask", () => {
  const due = "2026-09-18T18:00:00.000Z";
  const sameDay = "2026-09-18T19:30:00.000Z";
  const nextDay = "2026-09-19T18:00:00.000Z";

  it("updates the existing calendar-linked task", () => {
    expect(
      planCalendarMeetingTask({
        existingByEventId: { id: "cal-task" },
        openMeetingsWithoutEvent: [{ id: "operator-task", dueAt: due }],
        scheduledAt: due,
      }),
    ).toEqual({
      action: "update",
      taskId: "cal-task",
      closeDuplicateIds: ["operator-task"],
    });
  });

  it("attaches a calendar event to an open meeting on the same local day", () => {
    expect(
      planCalendarMeetingTask({
        existingByEventId: null,
        openMeetingsWithoutEvent: [
          { id: "operator-task", dueAt: sameDay },
          { id: "later", dueAt: nextDay },
        ],
        scheduledAt: due,
      }),
    ).toEqual({
      action: "update",
      taskId: "operator-task",
      closeDuplicateIds: [],
    });
  });

  it("inserts when no same-day open meeting exists", () => {
    expect(
      planCalendarMeetingTask({
        existingByEventId: null,
        openMeetingsWithoutEvent: [{ id: "later", dueAt: nextDay }],
        scheduledAt: due,
      }),
    ).toEqual({ action: "insert", closeDuplicateIds: [] });
  });

  it("closes extra same-day operator meetings after attaching one", () => {
    expect(
      planCalendarMeetingTask({
        existingByEventId: null,
        openMeetingsWithoutEvent: [
          { id: "closer", dueAt: due },
          { id: "extra", dueAt: sameDay },
        ],
        scheduledAt: due,
      }),
    ).toEqual({
      action: "update",
      taskId: "closer",
      closeDuplicateIds: ["extra"],
    });
  });
});
