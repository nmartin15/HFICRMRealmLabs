import { describe, expect, it } from "vitest";
import { summarizeDryRun, type ScoreDryRunRow } from "./score-adapter.js";

function row(
  overrides: Partial<ScoreDryRunRow> &
    Pick<ScoreDryRunRow, "email" | "manualBucket" | "engineBucket" | "score">,
): ScoreDryRunRow {
  const merged = {
    personId: overrides.email,
    holdSummary: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    manualAt: null,
    manualAgeDays: null,
    engineOwnsLeadTemp: false,
    handMarkSource: null,
    ...overrides,
  };
  if (merged.handMarkSource === null && merged.manualAt) {
    merged.handMarkSource = "dropdown";
  }
  return merged;
}

describe("summarizeDryRun", () => {
  it("counts buckets, drops, and ages hand-set temps without writing", () => {
    const asOf = new Date("2026-09-12T00:00:00.000Z");
    const rows: ScoreDryRunRow[] = [
      row({
        email: "a@x.com",
        manualBucket: "hot",
        engineBucket: "warm",
        score: 56,
        manualAt: "2026-09-10T00:00:00.000Z",
      }),
      row({
        email: "b@x.com",
        manualBucket: "cold",
        engineBucket: "warm",
        score: 60,
        manualAt: "2026-01-01T00:00:00.000Z",
      }),
      row({
        email: "c@x.com",
        manualBucket: null,
        engineBucket: "cold",
        score: 8,
      }),
      row({
        email: "d@x.com",
        manualBucket: "warm",
        engineBucket: "warm",
        score: 55,
      }),
    ];
    const report = summarizeDryRun(rows, asOf);
    expect(report.total).toBe(4);
    expect(report.nullManual).toBe(1);
    expect(report.hysteresisSeeds).toBe(3);
    expect(report.byBucket).toEqual({
      cold: 1,
      lukewarm: 0,
      warm: 3,
      hot: 0,
    });
    expect(report.drops).toBe(1);
    expect(report.dropAge).toEqual({
      recentUnder21d: 1,
      mid: 0,
      oldOver90d: 0,
      unknown: 0,
    });
    expect(report.rises).toBe(1);
    expect(report.disagreements.map((item) => item.email)).toEqual([
      "b@x.com",
      "a@x.com",
    ]);
    expect(report.disagreements[0]?.manualAgeDays).toBe(254);
    expect(report.disagreements[1]?.manualAgeDays).toBe(2);
    expect(report.recentHandMarks).toBe(1);
    expect(report.recentDisagreements).toBe(1);
    expect(report.recentDrops).toBe(1);
    expect(report.recentRises).toBe(0);
    expect(report.recentDisagreeRate).toBe(1);
    expect(report.recentBySource).toEqual({
      dropdown: 1,
      import: 0,
      other: 0,
    });
    expect(report.insufficientRecentMarks).toBe(true);
    expect(report.weightsWrong).toBe(false);
    expect(report.calibrationHandMarks).toBe(1);
    expect(report.calibrationDisagreements).toBe(1);
    expect(report.handRead.map((item) => item.email)).toEqual([
      "b@x.com",
      "a@x.com",
    ]);
    expect(report.components.conversations.n).toBe(0);
    expect(report.caps).toEqual({
      none: 0,
      unknown_budget: 0,
      not_qualified: 0,
    });
    expect(report.skipped).toBe(0);
  });

  it("does not call weights wrong at exactly a quarter of recent hand marks", () => {
    const asOf = new Date("2026-09-12T00:00:00.000Z");
    const recent = "2026-09-10T00:00:00.000Z";
    const report = summarizeDryRun(
      [
        row({
          email: "agree-1@x.com",
          manualBucket: "warm",
          engineBucket: "warm",
          score: 55,
          manualAt: recent,
        }),
        row({
          email: "agree-2@x.com",
          manualBucket: "hot",
          engineBucket: "hot",
          score: 82,
          manualAt: recent,
        }),
        row({
          email: "agree-3@x.com",
          manualBucket: "lukewarm",
          engineBucket: "lukewarm",
          score: 40,
          manualAt: recent,
        }),
        row({
          email: "drop@x.com",
          manualBucket: "hot",
          engineBucket: "warm",
          score: 56,
          manualAt: recent,
        }),
      ],
      asOf,
    );
    expect(report.recentHandMarks).toBe(4);
    expect(report.recentDisagreements).toBe(1);
    expect(report.recentDrops).toBe(1);
    expect(report.recentRises).toBe(0);
    expect(report.recentDisagreeRate).toBe(0.25);
    expect(report.insufficientRecentMarks).toBe(true);
    expect(report.weightsWrong).toBe(false);
  });

  it("calls weights wrong when eight recent marks disagree more than a quarter", () => {
    const asOf = new Date("2026-09-12T00:00:00.000Z");
    const recent = "2026-09-10T00:00:00.000Z";
    const report = summarizeDryRun(
      [
        row({
          email: "agree-1@x.com",
          manualBucket: "warm",
          engineBucket: "warm",
          score: 55,
          manualAt: recent,
        }),
        row({
          email: "agree-2@x.com",
          manualBucket: "hot",
          engineBucket: "hot",
          score: 82,
          manualAt: recent,
        }),
        row({
          email: "agree-3@x.com",
          manualBucket: "lukewarm",
          engineBucket: "lukewarm",
          score: 40,
          manualAt: recent,
        }),
        row({
          email: "agree-4@x.com",
          manualBucket: "cold",
          engineBucket: "cold",
          score: 8,
          manualAt: recent,
        }),
        row({
          email: "agree-5@x.com",
          manualBucket: "warm",
          engineBucket: "warm",
          score: 60,
          manualAt: recent,
        }),
        row({
          email: "drop@x.com",
          manualBucket: "hot",
          engineBucket: "warm",
          score: 56,
          manualAt: recent,
        }),
        row({
          email: "rise@x.com",
          manualBucket: "cold",
          engineBucket: "lukewarm",
          score: 32,
          manualAt: recent,
        }),
        row({
          email: "far@x.com",
          manualBucket: "cold",
          engineBucket: "hot",
          score: 90,
          manualAt: recent,
        }),
      ],
      asOf,
    );
    expect(report.recentHandMarks).toBe(8);
    expect(report.recentDisagreements).toBe(3);
    expect(report.recentDrops).toBe(1);
    expect(report.recentRises).toBe(2);
    expect(report.recentDisagreeRate).toBe(0.375);
    expect(report.insufficientRecentMarks).toBe(false);
    expect(report.weightsWrong).toBe(true);
  });

  it("does not treat engine-owned lead_temp as a recent hand mark", () => {
    const asOf = new Date("2026-09-12T00:00:00.000Z");
    const report = summarizeDryRun(
      [
        row({
          email: "owned@x.com",
          manualBucket: "hot",
          engineBucket: "warm",
          score: 56,
          manualAt: "2026-09-10T00:00:00.000Z",
          engineOwnsLeadTemp: true,
        }),
      ],
      asOf,
    );
    expect(report.recentHandMarks).toBe(0);
    expect(report.recentDisagreements).toBe(0);
    expect(report.insufficientRecentMarks).toBe(true);
    expect(report.weightsWrong).toBe(false);
  });

  it("counts 60-day marks for the hand-read list without moving the 21-day line", () => {
    const asOf = new Date("2026-09-12T00:00:00.000Z");
    const report = summarizeDryRun(
      [
        row({
          email: "recent@x.com",
          manualBucket: "hot",
          engineBucket: "warm",
          score: 56,
          manualAt: "2026-09-10T00:00:00.000Z",
        }),
        row({
          email: "mid@x.com",
          manualBucket: "hot",
          engineBucket: "warm",
          score: 56,
          manualAt: "2026-08-03T00:00:00.000Z",
        }),
      ],
      asOf,
    );
    expect(report.recentHandMarks).toBe(1);
    expect(report.recentDisagreements).toBe(1);
    expect(report.calibrationHandMarks).toBe(2);
    expect(report.calibrationDisagreements).toBe(2);
    expect(report.calibrationDisagreeRate).toBe(1);
    expect(report.insufficientRecentMarks).toBe(true);
    expect(report.weightsWrong).toBe(false);
  });

  it("does not let imported lead_temp fire the weights-wrong line", () => {
    const asOf = new Date("2026-09-12T00:00:00.000Z");
    const recent = "2026-09-10T00:00:00.000Z";
    const imported = (n: number) =>
      row({
        email: `import-${n}@x.com`,
        manualBucket: "hot",
        engineBucket: "warm",
        score: 56,
        manualAt: recent,
        handMarkSource: "import",
      });
    const report = summarizeDryRun(
      [1, 2, 3, 4, 5, 6, 7, 8].map(imported),
      asOf,
    );
    expect(report.recentHandMarks).toBe(8);
    expect(report.recentBySource).toEqual({
      dropdown: 0,
      import: 8,
      other: 0,
    });
    expect(report.recentDisagreements).toBe(0);
    expect(report.handRead).toEqual([]);
    expect(report.calibrationDisagreeRate).toBeNull();
    expect(report.insufficientRecentMarks).toBe(true);
    expect(report.weightsWrong).toBe(false);
  });

  it("prints component firing from the scored book", () => {
    const asOf = new Date("2026-09-12T00:00:00.000Z");
    const report = summarizeDryRun(
      [
        row({
          email: "a@x.com",
          manualBucket: "warm",
          engineBucket: "warm",
          score: 55,
        }),
      ],
      asOf,
      [
        [
          {
            id: "conversations",
            max: 20,
            raw: 0,
            contribution: 0,
            reason: "no_conversations",
          },
          {
            id: "replies",
            max: 15,
            raw: 4,
            contribution: 4,
            reason: "count_1_decay_days_3",
          },
        ],
      ],
      ["unknown_budget"],
      2,
    );
    expect(report.components.conversations).toMatchObject({
      n: 1,
      zeroRaw: 1,
      firing: 0,
    });
    expect(report.components.replies).toMatchObject({
      n: 1,
      zeroRaw: 0,
      firing: 1,
      firingRate: 1,
      sumContribution: 4,
      reasons: { has_events: 1 },
    });
    expect(report.caps).toEqual({
      none: 0,
      unknown_budget: 1,
      not_qualified: 0,
    });
    expect(report.skipped).toBe(2);
  });
});
