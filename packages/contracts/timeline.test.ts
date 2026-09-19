import { describe, expect, it } from "vitest";
import type { Activity } from "./activities";
import type { EmailThreadWithMessages } from "./email-threads";
import {
  describeContactTimelineActivity,
  isContactTimelineActivity,
  mergePersonTimeline,
  taskGuidePayloadsFromActivities,
} from "./timeline";

const base = {
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function activity(
  overrides: Partial<Activity> & Pick<Activity, "id" | "occurredAt">,
): Activity {
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
  overrides: Partial<EmailThreadWithMessages> &
    Pick<EmailThreadWithMessages, "id" | "lastMessageAt">,
): EmailThreadWithMessages {
  return {
    personId: "11111111-1111-4111-8111-111111111111",
    mailbox: "partner",
    gmailThreadId: "thread-1",
    subject: "Hello",
    snippet: "Hi",
    participantEmails: ["a@example.com"],
    sharedVisible: false,
    messages: [],
    ...base,
    ...overrides,
  };
}

describe("isContactTimelineActivity", () => {
  it("keeps last-contact actions", () => {
    expect(
      isContactTimelineActivity(
        activity({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          occurredAt: "2026-08-10T12:00:00.000Z",
          type: "note",
          payload: { what: "note" },
        }),
      ),
    ).toBe(true);
    expect(
      isContactTimelineActivity(
        activity({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          occurredAt: "2026-08-10T12:00:00.000Z",
          type: "note",
          payload: { what: "task.complete" },
        }),
      ),
    ).toBe(true);
    expect(
      isContactTimelineActivity(
        activity({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          occurredAt: "2026-08-10T12:00:00.000Z",
          type: "meeting",
          payload: { what: "meeting.scheduled" },
        }),
      ),
    ).toBe(true);
    expect(
      isContactTimelineActivity(
        activity({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          occurredAt: "2026-08-10T12:00:00.000Z",
          type: "field_change",
          payload: { what: "outbound.sent" },
        }),
      ),
    ).toBe(true);
  });

  it("hides audit field changes and bookkeeping", () => {
    for (const what of [
      "person.update",
      "person.create",
      "score.nightly_drift",
      "campaign.tag_change",
      "signal.extract",
      "inspect.gap_seed",
      "email.received",
      "email.thread_linked",
      "task.create",
      "task.update",
      "task.delete",
      "allocation.stage_change",
      "allocation.decide",
    ]) {
      expect(
        isContactTimelineActivity(
          activity({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            occurredAt: "2026-08-10T12:00:00.000Z",
            type: "field_change",
            payload: { what },
          }),
        ),
        what,
      ).toBe(false);
    }
  });
});

describe("describeContactTimelineActivity", () => {
  it("labels meeting and send events for operators", () => {
    expect(
      describeContactTimelineActivity({ what: "meeting.scheduled" }),
    ).toBe("Meeting scheduled");
    expect(
      describeContactTimelineActivity({
        what: "meeting.outcome",
        after: { outcome: "held" },
      }),
    ).toBe("Meeting held");
    expect(describeContactTimelineActivity({ what: "outbound.sent" })).toBe(
      "Campaign email sent",
    );
    expect(
      describeContactTimelineActivity({ what: "person.update" }),
    ).toBeNull();
  });
});

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

  it("drops audit writes and keeps last-contact rows", () => {
    const merged = mergePersonTimeline({
      activities: [
        activity({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          occurredAt: "2026-08-12T12:00:00.000Z",
          type: "field_change",
          payload: { what: "person.update" },
        }),
        activity({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          occurredAt: "2026-08-11T12:00:00.000Z",
          type: "email",
          payload: { what: "email.received" },
        }),
        activity({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          occurredAt: "2026-08-10T12:00:00.000Z",
          type: "note",
          payload: { what: "note", after: { text: "Called Stefano" } },
        }),
        activity({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          occurredAt: "2026-08-09T12:00:00.000Z",
          type: "field_change",
          payload: { what: "score.nightly_drift" },
        }),
      ],
      threads: [
        thread({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          lastMessageAt: "2026-08-11T15:00:00.000Z",
        }),
      ],
    });

    expect(
      merged.map((item) =>
        item.kind === "email" ? "email" : item.activity.payload.what,
      ),
    ).toEqual(["email", "note"]);
  });
});

describe("taskGuidePayloadsFromActivities", () => {
  it("keeps task create and complete for leftover classification", () => {
    const payloads = taskGuidePayloadsFromActivities([
      activity({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        occurredAt: "2026-08-10T12:00:00.000Z",
        payload: { what: "person.update" },
      }),
      activity({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        occurredAt: "2026-08-10T12:00:00.000Z",
        payload: { what: "task.create", after: { taskId: "t1" } },
      }),
      activity({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        occurredAt: "2026-08-10T12:00:00.000Z",
        payload: { what: "task.complete", after: { taskId: "t0" } },
      }),
    ]);

    expect(payloads.map((payload) => payload.what)).toEqual([
      "task.create",
      "task.complete",
    ]);
  });
});
