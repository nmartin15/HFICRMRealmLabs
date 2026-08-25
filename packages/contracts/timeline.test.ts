import { describe, expect, it } from "vitest";
import type { Activity } from "./activities";
import type { EmailThread } from "./email-threads";
import type { Meeting } from "./meetings";
import { mergePersonTimeline } from "./timeline";

const base = {
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function activity(overrides: Partial<Activity> & Pick<Activity, "id" | "occurredAt">): Activity {
  return {
    personId: "11111111-1111-4111-8111-111111111111",
    userId: null,
    type: "note",
    payload: {},
    ...base,
    ...overrides,
  };
}

function meeting(overrides: Partial<Meeting> & Pick<Meeting, "id" | "scheduledAt">): Meeting {
  return {
    personId: "11111111-1111-4111-8111-111111111111",
    calendarEventId: null,
    outcome: "scheduled",
    needsReview: false,
    notes: null,
    createdBy: "22222222-2222-4222-8222-222222222222",
    ...base,
    ...overrides,
  };
}

function thread(
  overrides: Partial<EmailThread> & Pick<EmailThread, "id" | "lastMessageAt">,
): EmailThread {
  return {
    personId: "11111111-1111-4111-8111-111111111111",
    mailbox: "shared",
    gmailThreadId: "thread-1",
    subject: "Hello",
    snippet: "Hi",
    participantEmails: ["a@example.com"],
    sharedVisible: false,
    ...base,
    ...overrides,
  };
}

describe("mergePersonTimeline", () => {
  it("merges activities, meetings, and threads newest first", () => {
    const merged = mergePersonTimeline({
      activities: [
        activity({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          occurredAt: "2026-08-10T12:00:00.000Z",
        }),
      ],
      meetings: [
        meeting({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          scheduledAt: "2026-08-12T12:00:00.000Z",
        }),
      ],
      threads: [
        thread({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          lastMessageAt: "2026-08-11T12:00:00.000Z",
        }),
      ],
    });

    expect(merged.map((item) => item.kind)).toEqual([
      "meeting",
      "email",
      "activity",
    ]);
    expect(merged.map((item) => item.occurredAt)).toEqual([
      "2026-08-12T12:00:00.000Z",
      "2026-08-11T12:00:00.000Z",
      "2026-08-10T12:00:00.000Z",
    ]);
  });
});
