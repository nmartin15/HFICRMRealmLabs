import { describe, expect, it } from "vitest";
import { createPersonBodySchema, planContactKindChange, planManualContact, planRecruiterSource } from "./people";

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

  it("blocks a suppressed email even when no person exists", () => {
    expect(
      planManualContact({
        name: "Ada Lovelace",
        existing: null,
        suppressed: true,
      }),
    ).toMatchObject({ ok: false, status: 409, code: "SUPPRESSED" });
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

  it("defaults new people to contact kind", () => {
    const parsed = createPersonBodySchema.safeParse({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.contactKind).toBe("contact");
    }
  });

  it("requires specialty for recruiter contacts", () => {
    expect(
      createPersonBodySchema.safeParse({
        name: "Ada Lovelace",
        email: "ada@example.com",
        contactKind: "recruiter",
      }).success,
    ).toBe(false);
    expect(
      createPersonBodySchema.safeParse({
        name: "Ada Lovelace",
        email: "ada@example.com",
        contactKind: "recruiter",
        recruiterSpecialty: "quant_analyst",
      }).success,
    ).toBe(true);
  });

  it("requires a recruiter id when source is recruiter", () => {
    expect(
      createPersonBodySchema.safeParse({
        name: "Ada Lovelace",
        email: "ada@example.com",
        source: "recruiter",
      }).success,
    ).toBe(false);
    expect(
      createPersonBodySchema.safeParse({
        name: "Ada Lovelace",
        email: "ada@example.com",
        source: "recruiter",
        sourceRecruiterId: existing.id,
      }).success,
    ).toBe(true);
  });

  it("rejects a recruiter sourced from another recruiter", () => {
    expect(
      createPersonBodySchema.safeParse({
        name: "Ada Lovelace",
        email: "ada@example.com",
        contactKind: "recruiter",
        recruiterSpecialty: "quant_developer",
        source: "recruiter",
        sourceRecruiterId: existing.id,
      }).success,
    ).toBe(false);
  });
});

describe("planContactKindChange", () => {
  it("requires specialty and a clear board for recruiters", () => {
    expect(
      planContactKindChange({
        contactKind: "recruiter",
        recruiterSpecialty: "quant_analyst",
        programTrack: null,
        hasBoardCard: false,
        source: "linkedin",
      }),
    ).toEqual({
      ok: true,
      contactKind: "recruiter",
      recruiterSpecialty: "quant_analyst",
    });
    expect(
      planContactKindChange({
        contactKind: "recruiter",
        recruiterSpecialty: "quant_analyst",
        programTrack: "allocation",
        hasBoardCard: false,
        source: "linkedin",
      }),
    ).toMatchObject({ ok: false, status: 409, code: "RECRUITER_HAS_TRACK" });
    expect(
      planContactKindChange({
        contactKind: "recruiter",
        recruiterSpecialty: "quant_analyst",
        programTrack: null,
        hasBoardCard: true,
        source: "linkedin",
      }),
    ).toMatchObject({ ok: false, status: 409, code: "RECRUITER_ON_BOARD" });
  });
});

describe("planRecruiterSource", () => {
  it("requires a live recruiter contact", () => {
    expect(
      planRecruiterSource({
        source: "recruiter",
        sourceRecruiterId: existing.id,
        personId: null,
        target: {
          id: existing.id,
          contactKind: "recruiter",
          deleted: false,
        },
      }),
    ).toEqual({
      ok: true,
      source: "recruiter",
      sourceRecruiterId: existing.id,
    });
    expect(
      planRecruiterSource({
        source: "recruiter",
        sourceRecruiterId: existing.id,
        personId: null,
        target: {
          id: existing.id,
          contactKind: "contact",
          deleted: false,
        },
      }),
    ).toMatchObject({ ok: false, code: "NOT_A_RECRUITER" });
    expect(
      planRecruiterSource({
        source: "recruiter",
        sourceRecruiterId: existing.id,
        personId: existing.id,
        target: {
          id: existing.id,
          contactKind: "recruiter",
          deleted: false,
        },
      }),
    ).toMatchObject({ ok: false, code: "RECRUITER_SELF" });
  });
});
