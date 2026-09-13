import { describe, expect, it } from "vitest";
import {
  extractDocument,
  foldExtractedSignals,
  type ExtractedSignal,
} from "./signals";

describe("extractDocument", () => {
  it("finds nothing in scheduling noise", () => {
    expect(
      extractDocument({
        text: "Does Thursday at 3pm work? Here's my calendar link.",
      }).findings,
    ).toEqual([]);
    expect(
      extractDocument({
        text: "Works for me. See you then.",
      }).findings,
    ).toEqual([]);
  });

  it("does not infer budget from enthusiasm", () => {
    const result = extractDocument({
      text: "This is exciting — looking forward to it, this could be huge.",
    });
    expect(result.findings).toEqual([]);
    expect(result.optOut).toBeNull();
  });

  it("does not treat fund AUM as program-fee capital", () => {
    const result = extractDocument({
      text: "We manage $50m AUM across the book.",
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: "aum_or_budget",
      value: { capitalKind: "aum", amountUsd: 50_000_000 },
    });
    expect(foldExtractedSignals(result.findings).statedProgramFee).toBe(false);
  });

  it("records a first-person program fee, not a bare dollar amount", () => {
    const fee = extractDocument({
      text: "I can pay $12k for the incubator fee personally.",
    });
    expect(fee.findings[0]).toMatchObject({
      kind: "aum_or_budget",
      value: { capitalKind: "program_fee", amountUsd: 12_000 },
    });
    expect(foldExtractedSignals(fee.findings).statedProgramFee).toBe(true);

    const bare = extractDocument({
      text: "The $10k program sounds interesting.",
    });
    expect(bare.findings[0]).toMatchObject({
      kind: "aum_or_budget",
      value: { capitalKind: "unknown" },
    });
    expect(foldExtractedSignals(bare.findings).statedProgramFee).toBe(false);
  });

  it("prefers AUM when a sentence mixes fund size and a fee number", () => {
    const result = extractDocument({
      text: "I manage $20m AUM and can pay the incubator fee.",
    });
    const budget = result.findings.filter((row) => row.kind === "aum_or_budget");
    expect(budget.some((row) => row.value.capitalKind === "aum")).toBe(true);
  });

  it("extracts an explicit start timeline, not a meeting time", () => {
    const start = extractDocument({
      text: "We want to start this week if the program is a fit.",
    });
    expect(foldExtractedSignals(start.findings).timeline).toBe("now");

    const meeting = extractDocument({
      text: "Let's speak Thursday at 3pm.",
    });
    expect(meeting.findings).toEqual([]);
  });

  it("routes plain-language opt-out and ignores waitlist language", () => {
    const optOut = extractDocument({
      text: "Please take me off your list. I don't want more emails.",
    });
    expect(optOut.optOut?.excerpt.toLowerCase()).toMatch(/take me off/);

    const waitlist = extractDocument({
      text: "Please take me off the waitlist when a seat opens.",
    });
    expect(waitlist.optOut).toBeNull();
  });

  it("is willing to return no findings and never a score", () => {
    const result = extractDocument({ text: "Thanks, received." });
    expect(result.findings).toEqual([]);
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("bucket");
  });

  it("ignores quoted operator text", () => {
    const result = extractDocument({
      text: "Sounds good.\n\nOn Mon, Nathan wrote:\n> The program fee is $10k if you can pay.",
    });
    expect(
      result.findings.some(
        (row) =>
          row.kind === "aum_or_budget" && row.value.capitalKind === "program_fee",
      ),
    ).toBe(false);
  });
});

describe("foldExtractedSignals", () => {
  it("does not let AUM or fit-no move extracted score facts", () => {
    const findings: ExtractedSignal[] = [
      {
        kind: "aum_or_budget",
        value: {
          amountUsd: 50_000_000,
          amountRaw: "$50m",
          capitalKind: "aum",
        },
        excerpt: "We manage $50m AUM",
      },
      {
        kind: "program_fit",
        value: { fit: "no", program: "unknown" },
        excerpt: "not a fit",
      },
    ];
    expect(foldExtractedSignals(findings)).toEqual({
      statedProgramFee: false,
      explicitProgramFit: "unknown",
      timeline: "unknown",
    });
  });
});
