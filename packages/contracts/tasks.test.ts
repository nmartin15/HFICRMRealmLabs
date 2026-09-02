import { describe, expect, it } from "vitest";
import { planCompleteTask, planCreateTask } from "./tasks";

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
});
