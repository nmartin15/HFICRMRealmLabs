import { describe, expect, it } from "vitest";
import {
  appendWebsiteLeadMessage,
  formatWebsiteLeadNotes,
  isWebsiteLeadHoneypot,
  planWebsiteLead,
  websiteLeadBodySchema,
} from "./leads";

describe("websiteLeadBodySchema", () => {
  it("requires name, email, programInterest and lowercases email", () => {
    const parsed = websiteLeadBodySchema.parse({
      name: " Ada Lovelace ",
      email: "Ada@Example.COM",
      programInterest: "not_sure",
    });
    expect(parsed).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      programInterest: "not_sure",
    });
  });

  it("rejects unknown fields", () => {
    const result = websiteLeadBodySchema.safeParse({
      name: "Ada Lovelace",
      email: "ada@example.com",
      programInterest: "not_sure",
      extra: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects message longer than 1000 chars", () => {
    const result = websiteLeadBodySchema.safeParse({
      name: "Ada Lovelace",
      email: "ada@example.com",
      programInterest: "hedge_fund_incubator",
      message: "x".repeat(1001),
    });
    expect(result.success).toBe(false);
  });
});

describe("isWebsiteLeadHoneypot", () => {
  it("treats non-empty company as honeypot", () => {
    expect(
      isWebsiteLeadHoneypot({
        name: "Ada Lovelace",
        email: "ada@example.com",
        programInterest: "not_sure",
        company: "Acme",
      }),
    ).toBe(true);
    expect(
      isWebsiteLeadHoneypot({
        name: "Ada Lovelace",
        email: "ada@example.com",
        programInterest: "not_sure",
        company: "  ",
      }),
    ).toBe(false);
  });
});

describe("formatWebsiteLeadNotes", () => {
  it("joins message, linkedin, and years", () => {
    expect(
      formatWebsiteLeadNotes({
        message: " Hello ",
        linkedinUrl: "https://linkedin.com/in/ada",
        yearsExperience: 5,
      }),
    ).toBe(
      "Hello\nLinkedIn: https://linkedin.com/in/ada\nYears of experience: 5",
    );
  });

  it("returns null when empty", () => {
    expect(formatWebsiteLeadNotes({})).toBeNull();
  });
});

describe("appendWebsiteLeadMessage", () => {
  it("appends message to existing notes", () => {
    expect(appendWebsiteLeadMessage("Prior", "New note")).toBe("Prior\n\nNew note");
    expect(appendWebsiteLeadMessage(null, "New note")).toBe("New note");
    expect(appendWebsiteLeadMessage("Prior", undefined)).toBe("Prior");
  });
});

describe("planWebsiteLead", () => {
  it("plans create with split name and notes", () => {
    const plan = planWebsiteLead({
      name: "Ada Lovelace",
      message: "Interested",
      linkedinUrl: "https://linkedin.com/in/ada",
      existing: null,
      existingNotes: null,
    });
    expect(plan).toEqual({
      ok: true,
      action: "create",
      firstName: "Ada",
      lastName: "Lovelace",
      notes: "Interested\nLinkedIn: https://linkedin.com/in/ada",
    });
  });

  it("rejects single-token names", () => {
    const plan = planWebsiteLead({
      name: "Ada",
      existing: null,
      existingNotes: null,
    });
    expect(plan).toMatchObject({ ok: false, status: 400, code: "INVALID_NAME" });
  });

  it("plans update and ensures allocation card when missing", () => {
    const plan = planWebsiteLead({
      name: "Ada Lovelace",
      message: "Follow up",
      existing: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        doNotContact: false,
        deleted: false,
        hasAllocationCard: false,
      },
      existingNotes: "Prior",
    });
    expect(plan).toEqual({
      ok: true,
      action: "update",
      personId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      notes: "Prior\n\nFollow up",
      ensureAllocationCard: true,
      setProgramTrackAllocation: true,
    });
  });

  it("does not ensure card for DNC people", () => {
    const plan = planWebsiteLead({
      name: "Ada Lovelace",
      message: "Hi",
      existing: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        doNotContact: true,
        deleted: false,
        hasAllocationCard: false,
      },
      existingNotes: null,
    });
    expect(plan).toMatchObject({
      ok: true,
      action: "update",
      ensureAllocationCard: false,
      setProgramTrackAllocation: false,
    });
  });
});
