import { describe, expect, it } from "vitest";
import {
  buildHomeTodos,
  homeCounts,
  meetingNeedsOutcome,
} from "./home";
import type { MeetingDigestItem } from "./meetings";

const person = {
  id: "11111111-1111-4111-8111-111111111111",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
};

function meetingItem(at: string): MeetingDigestItem {
  return {
    person,
    meeting: {
      id: "22222222-2222-4222-8222-222222222222",
      personId: person.id,
      scheduledAt: at,
      calendarEventId: null,
      outcome: "scheduled",
      needsReview: false,
      notes: null,
      createdBy: "33333333-3333-4333-8333-333333333333",
      createdAt: at,
      updatedAt: at,
    },
  };
}

describe("home day snapshot", () => {
  it("treats scheduled meetings at or before now as needing an outcome", () => {
    const now = new Date("2026-08-25T18:00:00.000Z");
    expect(
      meetingNeedsOutcome("2026-08-25T17:00:00.000Z", "scheduled", now),
    ).toBe(true);
    expect(
      meetingNeedsOutcome("2026-08-25T19:00:00.000Z", "scheduled", now),
    ).toBe(false);
    expect(meetingNeedsOutcome("2026-08-25T17:00:00.000Z", "held", now)).toBe(
      false,
    );
  });

  it("builds todos for meetings, calls, emails, and board tasks", () => {
    const now = new Date("2026-08-25T18:00:00.000Z");
    const leftover = meetingItem("2026-08-24T17:00:00.000Z");
    const todayPast = meetingItem("2026-08-25T17:00:00.000Z");
    todayPast.meeting.id = "44444444-4444-4444-8444-444444444444";
    const todayUpcoming = meetingItem("2026-08-25T20:00:00.000Z");
    todayUpcoming.meeting.id = "55555555-5555-4555-8555-555555555555";

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
      now,
    });

    expect(todos.map((item) => item.kind)).toEqual([
      "close_meeting",
      "close_meeting",
      "task",
      "email",
      "call",
      "decision",
      "incubator",
    ]);
    expect(todos.some((item) => item.meetingId === todayUpcoming.meeting.id)).toBe(
      false,
    );

    const counts = homeCounts({
      todos,
      leftoverCount: 1,
      scheduleCount: 2,
      emailCount: 3,
    });
    expect(counts.todo).toBe(7);
    expect(counts.meetings).toBe(3);
    expect(counts.calls).toBe(4);
    expect(counts.emails).toBe(4);
  });
});
