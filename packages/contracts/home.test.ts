import { describe, expect, it } from "vitest";
import {
  buildHomeTodos,
  homeCounts,
  meetingTaskNeedsOutcome,
} from "./home";
import type { HomeScheduleItem } from "./home";
import type { Task } from "./tasks";

const person = {
  id: "11111111-1111-4111-8111-111111111111",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
};

function meetingTask(at: string, id: string): HomeScheduleItem {
  const task: Task = {
    id,
    personId: person.id,
    kind: "meeting",
    dueAt: at,
    notes: null,
    status: "open",
    calendarEventId: null,
    outcome: "scheduled",
    needsReview: false,
    createdBy: "33333333-3333-4333-8333-333333333333",
    createdAt: at,
    updatedAt: at,
  };
  return { person, task };
}

describe("home day snapshot", () => {
  it("treats open meeting tasks at or before now as needing an outcome", () => {
    const now = new Date("2026-08-25T18:00:00.000Z");
    expect(meetingTaskNeedsOutcome("2026-08-25T17:00:00.000Z", "open", now)).toBe(
      true,
    );
    expect(meetingTaskNeedsOutcome("2026-08-25T19:00:00.000Z", "open", now)).toBe(
      false,
    );
    expect(
      meetingTaskNeedsOutcome("2026-08-25T19:00:00.000Z", "open", now, true),
    ).toBe(true);
    expect(meetingTaskNeedsOutcome("2026-08-25T17:00:00.000Z", "done", now)).toBe(
      false,
    );
  });

  it("builds todos for meetings, untracked people, tasks, and board work", () => {
    const now = new Date("2026-08-25T18:00:00.000Z");
    const leftover = meetingTask(
      "2026-08-24T17:00:00.000Z",
      "22222222-2222-4222-8222-222222222222",
    );
    const todayPast = meetingTask(
      "2026-08-25T17:00:00.000Z",
      "44444444-4444-4444-8444-444444444444",
    );
    const todayUpcoming = meetingTask(
      "2026-08-25T20:00:00.000Z",
      "55555555-5555-4555-8555-555555555555",
    );

    const todos = buildHomeTodos({
      leftoverMeetings: [leftover],
      todayMeetings: [todayPast, todayUpcoming],
      openTasks: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          person,
          kind: "email",
          dueAt: "2026-08-25T15:00:00.000Z",
          notes: "Send intro",
        },
      ],
      unmatchedEmails: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          subject: "Intro",
          lastMessageAt: "2026-08-25T16:00:00.000Z",
          snippet: "Are you free?",
        },
      ],
      callsDue: [{ person, stageLabel: "In Conversation" }],
      decisions: [{ person }],
      incubatorWaiting: [{ person, stage: "applied" }],
      needsTrack: [person],
      needsReview: [
        {
          person,
          firstName: "Unknown",
          lastName: "Unknown",
          needsReview: true,
        },
      ],
      now,
    });

    expect(todos.map((item) => item.kind)).toEqual([
      "close_meeting",
      "close_meeting",
      "needs_track",
      "needs_review",
      "task",
      "email",
      "call",
      "decision",
      "incubator",
    ]);
    expect(todos.some((item) => item.taskId === todayUpcoming.task.id)).toBe(
      false,
    );
    expect(todos.find((item) => item.kind === "needs_track")?.detail).toBe(
      "Set program track",
    );
    expect(todos.find((item) => item.kind === "needs_review")?.detail).toBe(
      "Name missing",
    );

    const counts = homeCounts({
      todos,
      leftoverCount: 1,
      scheduleCount: 2,
      emailCount: 3,
    });
    expect(counts.todo).toBe(9);
    expect(counts.meetings).toBe(3);
    expect(counts.calls).toBe(4);
    expect(counts.emails).toBe(4);
  });
});
