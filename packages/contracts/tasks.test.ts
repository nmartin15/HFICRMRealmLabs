import { describe, expect, it } from "vitest";
import {
  classifyOpenTask,
  describeTaskActivity,
  isFollowUpTask,
  planCompleteTask,
  planCreateTask,
  planUpdateTask,
} from "./tasks";

describe("planCreateTask", () => {
  it("requires notes for DNC", () => {
    expect(
      planCreateTask({
        kind: "dnc",
        notes: "  ",
        personDoNotContact: false,
        personDeleted: false,
      }),
    ).toMatchObject({ ok: false, code: "DNC_REASON_REQUIRED" });
  });

  it("sets do not contact when creating a DNC task", () => {
    expect(
      planCreateTask({
        kind: "dnc",
        notes: "Not a fit",
        personDoNotContact: false,
        personDeleted: false,
      }),
    ).toEqual({
      ok: true,
      kind: "dnc",
      notes: "Not a fit",
      setDoNotContact: true,
    });
  });
});

describe("planUpdateTask", () => {
  const openEmail = {
    currentStatus: "open",
    currentKind: "email" as const,
    currentDueAt: "2026-09-08T16:00:00.000Z",
    currentNotes: "Prep",
    currentOutcome: null,
    personDeleted: false,
  };

  it("updates notes on an open task", () => {
    expect(
      planUpdateTask({
        ...openEmail,
        notes: "Talk about runway",
      }),
    ).toMatchObject({
      ok: true,
      notes: "Talk about runway",
      changed: true,
    });
  });

  it("lets a saved due date be corrected", () => {
    expect(
      planUpdateTask({
        ...openEmail,
        dueAt: "2026-09-10T16:00:00.000Z",
      }),
    ).toMatchObject({
      ok: true,
      dueAt: "2026-09-10T16:00:00.000Z",
      changed: true,
    });
  });

  it("allows edits on closed tasks", () => {
    expect(
      planUpdateTask({
        ...openEmail,
        currentStatus: "done",
        dueAt: "2026-09-09T16:00:00.000Z",
        notes: "Wrong date, fixed",
      }),
    ).toMatchObject({
      ok: true,
      dueAt: "2026-09-09T16:00:00.000Z",
      notes: "Wrong date, fixed",
    });
  });

  it("requires notes when the type is DNC", () => {
    expect(
      planUpdateTask({
        ...openEmail,
        kind: "dnc",
        notes: "  ",
      }),
    ).toMatchObject({ ok: false, code: "DNC_REASON_REQUIRED" });
  });
});

describe("planCompleteTask", () => {
  it("requires a follow-up unless DNC", () => {
    expect(
      planCompleteTask({
        currentKind: "call",
        currentStatus: "open",
        notes: "Left voicemail",
        outcome: undefined,
        next: undefined,
        personDoNotContact: false,
        personDeleted: false,
      }),
    ).toMatchObject({ ok: false, code: "FOLLOW_UP_REQUIRED" });
  });

  it("closes DNC with notes and no next task", () => {
    expect(
      planCompleteTask({
        currentKind: "dnc",
        currentStatus: "open",
        notes: "Asked not to be contacted",
        outcome: undefined,
        next: undefined,
        personDoNotContact: false,
        personDeleted: false,
      }),
    ).toEqual({
      ok: true,
      notes: "Asked not to be contacted",
      setDoNotContact: true,
      status: "done",
      outcome: null,
      next: null,
    });
  });

  it("accepts a follow-up meeting after a call", () => {
    expect(
      planCompleteTask({
        currentKind: "call",
        currentStatus: "open",
        notes: "Booked",
        outcome: undefined,
        next: {
          kind: "meeting",
          dueAt: "2026-09-02T18:00:00.000Z",
          notes: "Track record",
        },
        personDoNotContact: false,
        personDeleted: false,
      }),
    ).toMatchObject({
      ok: true,
      status: "done",
      next: { kind: "meeting", notes: "Track record" },
    });
  });

  it("requires a meeting outcome when closing a meeting task", () => {
    expect(
      planCompleteTask({
        currentKind: "meeting",
        currentStatus: "open",
        notes: "Showed up",
        outcome: undefined,
        next: {
          kind: "email",
          dueAt: "2026-09-03T18:00:00.000Z",
        },
        personDoNotContact: false,
        personDeleted: false,
      }),
    ).toMatchObject({ ok: false, code: "MEETING_OUTCOME_REQUIRED" });
  });

  it("records held and still requires a follow-up", () => {
    expect(
      planCompleteTask({
        currentKind: "meeting",
        currentStatus: "open",
        notes: "Good call",
        outcome: "held",
        next: {
          kind: "email",
          dueAt: "2026-09-03T18:00:00.000Z",
        },
        personDoNotContact: false,
        personDeleted: false,
      }),
    ).toMatchObject({
      ok: true,
      status: "done",
      outcome: "held",
      next: { kind: "email" },
    });
  });

  it("marks a meeting rescheduled", () => {
    expect(
      planCompleteTask({
        currentKind: "meeting",
        currentStatus: "open",
        notes: undefined,
        outcome: "rescheduled",
        next: {
          kind: "meeting",
          dueAt: "2026-09-10T18:00:00.000Z",
        },
        personDoNotContact: false,
        personDeleted: false,
      }),
    ).toMatchObject({
      ok: true,
      status: "rescheduled",
      outcome: "rescheduled",
    });
  });

  it("does not create another follow-up when one is already open", () => {
    expect(
      planCompleteTask({
        currentKind: "email",
        currentStatus: "open",
        notes: "Sent",
        outcome: undefined,
        next: {
          kind: "call",
          dueAt: "2026-09-12T16:00:00.000Z",
        },
        personDoNotContact: false,
        personDeleted: false,
        otherOpenTaskCount: 1,
      }),
    ).toMatchObject({
      ok: true,
      status: "done",
      next: null,
    });
  });
});

describe("describeTaskActivity", () => {
  it("names who completed what and that the follow-up was saved", () => {
    expect(
      describeTaskActivity({
        what: "task.complete",
        after: {
          taskId: "11111111-1111-4111-8111-111111111111",
          kind: "call",
          status: "done",
          next: { kind: "email", dueAt: "2026-09-10T16:00:00.000Z" },
        },
      }),
    ).toBe("Completed Call (done) · saved follow-up Email");
  });

  it("labels a follow-up create separately from a first task", () => {
    expect(
      describeTaskActivity({
        what: "task.create",
        after: {
          kind: "email",
          followUpFromTaskId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).toBe("Saved follow-up Email");
  });

  it("names due date corrections on the timeline", () => {
    expect(
      describeTaskActivity({
        what: "task.update",
        before: {
          kind: "email",
          dueAt: "2026-09-08T16:00:00.000Z",
          notes: "Prep",
        },
        after: {
          kind: "email",
          dueAt: "2026-09-10T16:00:00.000Z",
          notes: "Prep",
        },
      }),
    ).toBe("Updated Email due date");
  });
});

describe("isFollowUpTask", () => {
  it("matches a follow-up by created task id", () => {
    expect(
      isFollowUpTask(
        {
          id: "22222222-2222-4222-8222-222222222222",
          kind: "email",
          dueAt: "2026-09-08T16:00:00.000Z",
        },
        [
          {
            what: "task.create",
            after: {
              taskId: "22222222-2222-4222-8222-222222222222",
              kind: "email",
              dueAt: "2026-09-08T16:00:00.000Z",
              followUpFromTaskId: "11111111-1111-4111-8111-111111111111",
            },
          },
        ],
      ),
    ).toBe(true);
  });
});

describe("classifyOpenTask", () => {
  it("labels a still-open task leftover when timeline already completed it", () => {
    expect(
      classifyOpenTask({
        id: "22222222-2222-4222-8222-222222222222",
        kind: "email",
        dueAt: "2026-09-07T16:00:00.000Z",
        nowMs: Date.parse("2026-09-07T20:00:00.000Z"),
        payloads: [
          {
            what: "task.complete",
            after: { taskId: "22222222-2222-4222-8222-222222222222" },
          },
        ],
      }),
    ).toBe("leftover");
  });

  it("labels a past-due open task overdue", () => {
    expect(
      classifyOpenTask({
        id: "22222222-2222-4222-8222-222222222222",
        kind: "email",
        dueAt: "2026-09-07T16:00:00.000Z",
        nowMs: Date.parse("2026-09-07T20:00:00.000Z"),
        payloads: [],
      }),
    ).toBe("overdue");
  });
});
