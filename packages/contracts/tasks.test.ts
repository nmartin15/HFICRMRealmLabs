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
        next: undefined,
        personDoNotContact: false,
        personDeleted: false,
      }),
    ).toEqual({
      ok: true,
      notes: "Asked not to be contacted",
      setDoNotContact: true,
      next: null,
    });
  });

  it("accepts a follow-up meeting after a call", () => {
    expect(
      planCompleteTask({
        currentKind: "call",
        currentStatus: "open",
        notes: "Booked",
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
      next: { kind: "meeting", notes: "Track record" },
    });
  });
});
