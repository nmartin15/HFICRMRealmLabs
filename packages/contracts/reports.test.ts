import { describe, expect, it } from "vitest";
import type {
  ComputeReportInput,
  ReportMeetingInput,
  ReportPersonInput,
} from "./reports";
import { zonedIsoDate } from "./time";
import {
  addIsoDays,
  computeReport,
  currentWeekRange,
  dateInRange,
  formatReportRate,
  isoToZonedDate,
  matchingReportInputs,
  parseReportRange,
  ratio,
  reportExportFilename,
  reportTableCsv,
  reportTableTsv,
  shiftWeek,
  sumReportInputs,
} from "./reports";

const person = (
  overrides: Partial<ReportPersonInput> & Pick<ReportPersonInput, "id">,
): ReportPersonInput => ({
  appliedAt: "2026-08-24",
  budgetQualified: "unknown",
  allocationStage: "applied",
  allocationDecision: null,
  noCallAppLink: false,
  ...overrides,
});

const meeting = (
  overrides: Partial<ReportMeetingInput> & Pick<ReportMeetingInput, "id" | "personId">,
): ReportMeetingInput => ({
  scheduledAt: "2026-08-25T18:00:00.000Z",
  outcome: "held",
  ...overrides,
});

const baseInput = (): ComputeReportInput => ({
  range: { kind: "range", start: "2026-08-24", end: "2026-08-28" },
  periods: [
    {
      periodStart: "2026-08-24",
      periodEnd: "2026-08-28",
      linkedinImpressions: 1000,
      jobPostApplies: 40,
    },
    {
      periodStart: "2026-08-17",
      periodEnd: "2026-08-21",
      linkedinImpressions: 500,
      jobPostApplies: 10,
    },
  ],
  people: [],
  meetings: [],
});

function rowMap(input: ComputeReportInput) {
  const report = computeReport(input);
  return Object.fromEntries(report.rows.map((row) => [row.id, row]));
}

describe("parseReportRange", () => {
  it("treats a missing range as all time", () => {
    expect(parseReportRange({})).toEqual({
      ok: true,
      range: { kind: "all_time" },
    });
  });

  it("requires start and end together", () => {
    expect(parseReportRange({ start: "2026-08-24" })).toEqual({
      ok: false,
      message: "start and end are required together",
    });
    expect(parseReportRange({ end: "2026-08-28" })).toEqual({
      ok: false,
      message: "start and end are required together",
    });
  });

  it("rejects a start after end", () => {
    expect(
      parseReportRange({ start: "2026-08-28", end: "2026-08-24" }),
    ).toEqual({
      ok: false,
      message: "start must be on or before end",
    });
  });

  it("accepts an inclusive date range", () => {
    expect(
      parseReportRange({ start: "2026-08-24", end: "2026-08-28" }),
    ).toEqual({
      ok: true,
      range: { kind: "range", start: "2026-08-24", end: "2026-08-28" },
    });
  });
});

describe("week range", () => {
  it("defaults to Monday through Friday in America/Los_Angeles", () => {
    // Wednesday 2026-08-26 15:00 UTC = 08:00 PDT.
    expect(
      currentWeekRange(new Date("2026-08-26T15:00:00.000Z")),
    ).toEqual({ start: "2026-08-24", end: "2026-08-28" });
  });

  it("keeps Sunday in the week that began that Monday", () => {
    expect(
      currentWeekRange(new Date("2026-08-30T10:00:00.000Z")),
    ).toEqual({ start: "2026-08-24", end: "2026-08-28" });
  });

  it("uses the LA calendar date across midnight UTC", () => {
    // 2026-08-31T06:30Z is still Sunday 23:30 PDT.
    expect(
      currentWeekRange(new Date("2026-08-31T06:30:00.000Z")),
    ).toEqual({ start: "2026-08-24", end: "2026-08-28" });
    // 2026-08-31T07:00Z is Monday 00:00 PDT.
    expect(
      currentWeekRange(new Date("2026-08-31T07:00:00.000Z")),
    ).toEqual({ start: "2026-08-31", end: "2026-09-04" });
  });

  it("shifts a week by seven days", () => {
    expect(
      shiftWeek({ start: "2026-08-24", end: "2026-08-28" }, -1),
    ).toEqual({ start: "2026-08-17", end: "2026-08-21" });
    expect(
      shiftWeek({ start: "2026-08-24", end: "2026-08-28" }, 1),
    ).toEqual({ start: "2026-08-31", end: "2026-09-04" });
  });

  it("adds calendar days in UTC date space", () => {
    expect(addIsoDays("2026-08-28", 1)).toBe("2026-08-29");
    expect(addIsoDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("report inputs matching", () => {
  const periods = baseInput().periods;

  it("uses the exact matching period for a date range", () => {
    expect(
      matchingReportInputs(periods, {
        kind: "range",
        start: "2026-08-24",
        end: "2026-08-28",
      }),
    ).toEqual([periods[0]]);
    expect(
      sumReportInputs(
        matchingReportInputs(periods, {
          kind: "range",
          start: "2026-08-24",
          end: "2026-08-28",
        }),
      ),
    ).toEqual({ linkedinImpressions: 1000, jobPostApplies: 40 });
  });

  it("sums every period for all time", () => {
    expect(
      sumReportInputs(matchingReportInputs(periods, { kind: "all_time" })),
    ).toEqual({ linkedinImpressions: 1500, jobPostApplies: 50 });
  });

  it("returns zeros when no period matches the range", () => {
    expect(
      sumReportInputs(
        matchingReportInputs(periods, {
          kind: "range",
          start: "2026-08-25",
          end: "2026-08-28",
        }),
      ),
    ).toEqual({ linkedinImpressions: 0, jobPostApplies: 0 });
  });
});

describe("dateInRange and zoned meeting dates", () => {
  it("includes start and end dates", () => {
    const range = {
      kind: "range" as const,
      start: "2026-08-24",
      end: "2026-08-28",
    };
    expect(dateInRange("2026-08-24", range)).toBe(true);
    expect(dateInRange("2026-08-28", range)).toBe(true);
    expect(dateInRange("2026-08-23", range)).toBe(false);
    expect(dateInRange("2026-08-29", range)).toBe(false);
    expect(dateInRange(null, range)).toBe(false);
    expect(dateInRange("2026-01-01", { kind: "all_time" })).toBe(true);
    expect(dateInRange(null, { kind: "all_time" })).toBe(false);
  });

  it("maps meeting timestamps onto LA calendar dates", () => {
    expect(isoToZonedDate("2026-08-25T07:00:00.000Z")).toBe("2026-08-25");
    expect(isoToZonedDate("2026-08-25T06:59:00.000Z")).toBe("2026-08-24");
    expect(zonedIsoDate(new Date("2026-08-25T06:59:00.000Z"))).toBe(
      "2026-08-24",
    );
  });
});

describe("ratio formatting", () => {
  it("returns null when the denominator is zero", () => {
    expect(ratio(4, 0)).toBeNull();
    expect(formatReportRate(null)).toBe("—");
  });

  it("formats one decimal percent", () => {
    expect(ratio(40, 1000)).toBe(0.04);
    expect(formatReportRate(0.04)).toBe("4.0%");
    expect(formatReportRate(1)).toBe("100.0%");
  });
});

describe("computeReport", () => {
  it("computes LinkedIn rates from the matching period", () => {
    const rows = rowMap(baseInput());
    expect(rows.linkedin_impressions).toMatchObject({
      count: 1000,
      rate: null,
    });
    expect(rows.linkedin_applies).toMatchObject({
      count: 40,
      rate: 0.04,
    });
  });

  it("sums LinkedIn inputs across periods for all time", () => {
    const rows = rowMap({ ...baseInput(), range: { kind: "all_time" } });
    expect(rows.linkedin_impressions?.count).toBe(1500);
    expect(rows.linkedin_applies?.count).toBe(50);
    expect(rows.linkedin_applies?.rate).toBeCloseTo(50 / 1500);
  });

  it("counts applicants with applied_at in range as 100%", () => {
    const rows = rowMap({
      ...baseInput(),
      people: [
        person({ id: "a", appliedAt: "2026-08-24" }),
        person({ id: "b", appliedAt: "2026-08-28" }),
        person({ id: "c", appliedAt: "2026-08-23" }),
        person({ id: "d", appliedAt: null }),
      ],
    });
    expect(rows.total_applicants).toMatchObject({ count: 2, rate: 1 });
  });

  it("counts calls scheduled as people in range with at least one meeting", () => {
    const rows = rowMap({
      ...baseInput(),
      people: [
        person({ id: "a" }),
        person({ id: "b" }),
        person({ id: "c" }),
      ],
      meetings: [
        meeting({ id: "m1", personId: "a" }),
        meeting({ id: "m2", personId: "a", outcome: "scheduled" }),
        meeting({
          id: "m3",
          personId: "b",
          scheduledAt: "2026-09-01T18:00:00.000Z",
        }),
      ],
    });
    expect(rows.calls_scheduled).toMatchObject({
      count: 2,
      rate: 2 / 3,
    });
  });

  it("counts no-call app links over total applicants", () => {
    const rows = rowMap({
      ...baseInput(),
      people: [
        person({ id: "a", noCallAppLink: true }),
        person({ id: "b", noCallAppLink: false }),
        person({
          id: "out",
          appliedAt: "2026-08-10",
          noCallAppLink: true,
        }),
      ],
    });
    expect(rows.no_call_app_link).toMatchObject({
      count: 1,
      rate: 0.5,
    });
  });

  it("uses meetings with an outcome as the denominator for the outcome block", () => {
    const rows = rowMap({
      ...baseInput(),
      people: [
        person({
          id: "held-nb",
          allocationDecision: "route_incubator",
          budgetQualified: "no",
        }),
        person({
          id: "held-yes",
          allocationDecision: "route_incubator",
          budgetQualified: "yes",
        }),
        person({
          id: "alloc",
          allocationDecision: "allocate",
          budgetQualified: "yes",
        }),
        person({
          id: "unknown",
          allocationDecision: "route_incubator",
          budgetQualified: "unknown",
        }),
      ],
      meetings: [
        meeting({ id: "h1", personId: "held-nb", outcome: "held" }),
        meeting({ id: "h2", personId: "held-yes", outcome: "held" }),
        meeting({ id: "h3", personId: "alloc", outcome: "held" }),
        meeting({ id: "h4", personId: "unknown", outcome: "held" }),
        meeting({ id: "n1", personId: "held-nb", outcome: "no_show" }),
        meeting({
          id: "r1",
          personId: "alloc",
          outcome: "rescheduled",
        }),
        meeting({
          id: "s1",
          personId: "alloc",
          outcome: "scheduled",
        }),
        meeting({
          id: "outside",
          personId: "alloc",
          outcome: "held",
          scheduledAt: "2026-08-31T18:00:00.000Z",
        }),
      ],
    });

    expect(rows.meetings_with_outcome).toMatchObject({
      count: 6,
      rate: null,
    });
    expect(rows.no_shows).toMatchObject({ count: 1, rate: 1 / 6 });
    expect(rows.rescheduled_with_notice).toMatchObject({
      count: 1,
      rate: 1 / 6,
    });
    expect(rows.qualified_incubator_not_budget).toMatchObject({
      count: 2,
      rate: 2 / 6,
    });
    expect(rows.budget_qualified_incubator).toMatchObject({
      count: 1,
      rate: 1 / 6,
    });
    expect(rows.qualified_for_allocation).toMatchObject({
      count: 1,
      rate: 1 / 6,
    });
  });

  it("counts a person once even with two held meetings", () => {
    const rows = rowMap({
      ...baseInput(),
      people: [
        person({
          id: "a",
          allocationDecision: "allocate",
        }),
      ],
      meetings: [
        meeting({ id: "m1", personId: "a", outcome: "held" }),
        meeting({ id: "m2", personId: "a", outcome: "held" }),
      ],
    });
    expect(rows.meetings_with_outcome?.count).toBe(2);
    expect(rows.qualified_for_allocation?.count).toBe(1);
    expect(rows.qualified_for_allocation?.rate).toBe(0.5);
  });

  it("counts rejected allocation cards over total applicants", () => {
    const rows = rowMap({
      ...baseInput(),
      people: [
        person({ id: "a", allocationStage: "passed" }),
        person({ id: "b", allocationStage: "nurture" }),
        person({
          id: "c",
          appliedAt: "2026-07-01",
          allocationStage: "passed",
        }),
      ],
    });
    expect(rows.rejected).toMatchObject({ count: 1, rate: 0.5 });
  });

  it("returns null rates when a denominator is zero", () => {
    const rows = rowMap({
      range: { kind: "all_time" },
      periods: [],
      people: [],
      meetings: [],
    });
    expect(rows.linkedin_applies?.rate).toBeNull();
    expect(rows.total_applicants).toMatchObject({ count: 0, rate: null });
    expect(rows.calls_scheduled?.rate).toBeNull();
    expect(rows.no_shows?.rate).toBeNull();
    expect(rows.rejected?.rate).toBeNull();
  });

  it("includes the denominator footnote", () => {
    const report = computeReport(baseInput());
    expect(report.footnote).toContain("total applicants");
    expect(report.footnote).toContain("meetings with an outcome");
    expect(report.footnote).toContain("LinkedIn impressions");
  });
});

describe("export", () => {
  it("quotes CSV cells that contain commas", () => {
    const report = computeReport({
      ...baseInput(),
      people: [person({ id: "a", noCallAppLink: true })],
    });
    const csv = reportTableCsv(report.rows);
    expect(csv.startsWith("Metric,Count,Rate\n")).toBe(true);
    expect(csv).toContain('"No call, app link sent",1,100.0%');
    expect(csv).toContain("LinkedIn impressions,1000,—");
    expect(csv).toContain("Qualified (not budget) for incubator,0,—");
  });

  it("writes a TSV table for Sheets", () => {
    const report = computeReport(baseInput());
    const tsv = reportTableTsv(report.rows);
    expect(tsv.split("\n")[0]).toBe("Metric\tCount\tRate");
    expect(tsv).toContain("LinkedIn impressions\t1000\t—");
    expect(tsv).toContain("Applied to LinkedIn job post\t40\t4.0%");
  });

  it("names the download from the selected range", () => {
    expect(reportExportFilename({ kind: "all_time" })).toBe(
      "reports-all-time.csv",
    );
    expect(
      reportExportFilename({
        kind: "range",
        start: "2026-08-24",
        end: "2026-08-28",
      }),
    ).toBe("reports-2026-08-24_2026-08-28.csv");
  });
});
