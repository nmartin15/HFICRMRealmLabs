import { describe, expect, it } from "vitest";
import type { Activity } from "./activities";
import type { EmailThread } from "./email-threads";
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
  it("merges activities and threads newest first", () => {
    const merged = mergePersonTimeline({
      activities: [
        activity({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          occurredAt: "2026-08-10T12:00:00.000Z",
        }),
      ],
      threads: [
        thread({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          lastMessageAt: "2026-08-11T12:00:00.000Z",
        }),
      ],
    });

    expect(merged.map((item) => item.kind)).toEqual(["email", "activity"]);
    expect(merged.map((item) => item.occurredAt)).toEqual([
      "2026-08-11T12:00:00.000Z",
      "2026-08-10T12:00:00.000Z",
    ]);
  });
});
