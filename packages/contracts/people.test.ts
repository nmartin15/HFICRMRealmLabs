import { describe, expect, it } from "vitest";
import { createPersonBodySchema, planManualContact } from "./people";

const existing = {
  id: "11111111-1111-4111-8111-111111111111",
  doNotContact: false,
  deleted: false,
};

describe("planManualContact", () => {
  it("creates an untracked person without a board", () => {
    expect(
      planManualContact({
        name: "Ada Lovelace",
        existing: null,
      }),
    ).toEqual({
      ok: true,
      firstName: "Ada",
      lastName: "Lovelace",
      reusePersonId: null,
      restoreDeleted: false,
    });
  });

  it("requires first and last name", () => {
    expect(
      planManualContact({
        name: "Ada",
        existing: null,
      }),
    ).toMatchObject({ ok: false, status: 400, code: "INVALID_NAME" });
  });

  it("blocks do not contact", () => {
    expect(
      planManualContact({
        name: "Ada Lovelace",
        existing: { ...existing, doNotContact: true },
      }),
    ).toMatchObject({ ok: false, status: 409, code: "DO_NOT_CONTACT" });
  });

  it("rejects a live duplicate email", () => {
    expect(
      planManualContact({
        name: "Ada Lovelace",
        existing,
      }),
    ).toMatchObject({ ok: false, status: 409, code: "EMAIL_EXISTS" });
  });

  it("restores a deleted person with the same email", () => {
    expect(
      planManualContact({
        name: "Ada Lovelace",
        existing: { ...existing, deleted: true },
      }),
    ).toEqual({
      ok: true,
      firstName: "Ada",
      lastName: "Lovelace",
      reusePersonId: existing.id,
      restoreDeleted: true,
    });
  });
});

describe("createPersonBodySchema", () => {
  it("accepts name and email without a program track or first task", () => {
    expect(
      createPersonBodySchema.safeParse({
        name: "Ada Lovelace",
        email: "ada@example.com",
      }).success,
    ).toBe(true);
  });

  it("lowercases email", () => {
    const parsed = createPersonBodySchema.safeParse({
      name: "Ada Lovelace",
      email: "Ada@Example.COM",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email).toBe("ada@example.com");
      expect(parsed.data.source).toBe("other");
    }
  });

  it("accepts an optional first follow-up", () => {
    expect(
      createPersonBodySchema.safeParse({
        name: "Ada Lovelace",
        email: "ada@example.com",
        firstTask: {
          kind: "call",
          dueAt: "2026-09-07T17:00:00.000Z",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects a missing name", () => {
    expect(
      createPersonBodySchema.safeParse({
        email: "ada@example.com",
      }).success,
    ).toBe(false);
  });
});
