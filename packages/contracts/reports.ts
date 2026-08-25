import { z } from "zod";
import type {
  AllocationDecision,
  AllocationStage,
  BudgetQualified,
  MeetingOutcome,
} from "./enums";
import { isoDateSchema } from "./enums";
import { addCalendarDays } from "./routing";
import { DISPLAY_TIME_ZONE, zonedIsoDate } from "./time";

export const REPORT_METRIC_IDS = [
  "linkedin_impressions",
  "linkedin_applies",
  "total_applicants",
  "calls_scheduled",
  "no_call_app_link",
  "meetings_with_outcome",
  "no_shows",
  "rescheduled_with_notice",
  "qualified_incubator_not_budget",
  "budget_qualified_incubator",
  "qualified_for_allocation",
  "rejected",
] as const;
export type ReportMetricId = (typeof REPORT_METRIC_IDS)[number];

export const REPORT_METRIC_LABELS: Record<ReportMetricId, string> = {
  linkedin_impressions: "LinkedIn impressions",
  linkedin_applies: "Applied to LinkedIn job post",
  total_applicants: "Total applicants",
  calls_scheduled: "Calls scheduled",
  no_call_app_link: "No call, app link sent",
  meetings_with_outcome: "Meetings with an outcome",
  no_shows: "No shows",
  rescheduled_with_notice: "Rescheduled with notice",
  qualified_incubator_not_budget: "Qualified (not budget) for incubator",
  budget_qualified_incubator: "Budget qualified for incubator",
  qualified_for_allocation: "Qualified for allocation",
  rejected: "Rejected",
};

export const REPORT_DENOMINATORS = [
  "none",
  "impressions",
  "applicants",
  "meetings_with_outcome",
] as const;
export type ReportDenominator = (typeof REPORT_DENOMINATORS)[number];

export const REPORT_METRIC_DENOMINATORS: Record<
  ReportMetricId,
  ReportDenominator
> = {
  linkedin_impressions: "none",
  linkedin_applies: "impressions",
  total_applicants: "applicants",
  calls_scheduled: "applicants",
  no_call_app_link: "applicants",
  meetings_with_outcome: "none",
  no_shows: "meetings_with_outcome",
  rescheduled_with_notice: "meetings_with_outcome",
  qualified_incubator_not_budget: "meetings_with_outcome",
  budget_qualified_incubator: "meetings_with_outcome",
  qualified_for_allocation: "meetings_with_outcome",
  rejected: "applicants",
};

export const REPORT_DENOMINATOR_FOOTNOTE =
  "Applied to LinkedIn job post uses LinkedIn impressions as the denominator. Total applicants is 100%. Calls scheduled, no call app link, and rejected use total applicants. No shows, rescheduled with notice, qualified (not budget) for incubator, budget qualified for incubator, and qualified for allocation use meetings with an outcome.";

const MEETING_OUTCOME_DENOMINATOR: ReadonlySet<MeetingOutcome> = new Set([
  "held",
  "no_show",
  "rescheduled",
]);

export const reportRangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all_time") }),
  z.object({
    kind: z.literal("range"),
    start: isoDateSchema,
    end: isoDateSchema,
  }),
]);
export type ReportRange = z.infer<typeof reportRangeSchema>;

export const reportQuerySchema = z.object({
  start: isoDateSchema.optional(),
  end: isoDateSchema.optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const reportDenominatorSchema = z.enum(REPORT_DENOMINATORS);
export const reportMetricIdSchema = z.enum(REPORT_METRIC_IDS);

export const reportRowSchema = z.object({
  id: reportMetricIdSchema,
  label: z.string(),
  count: z.number().int().nonnegative(),
  rate: z.number().nullable(),
  denominator: reportDenominatorSchema,
});
export type ReportRow = z.infer<typeof reportRowSchema>;

export const reportResponseSchema = z.object({
  range: reportRangeSchema,
  rows: z.array(reportRowSchema),
  footnote: z.string(),
});
export type ReportResponse = z.infer<typeof reportResponseSchema>;

export type ReportRangeParse =
  | { ok: true; range: ReportRange }
  | { ok: false; message: string };

export function parseReportRange(query: ReportQuery): ReportRangeParse {
  const start = query.start;
  const end = query.end;
  if (start === undefined && end === undefined) {
    return { ok: true, range: { kind: "all_time" } };
  }
  if (start === undefined || end === undefined) {
    return { ok: false, message: "start and end are required together" };
  }
  if (start > end) {
    return { ok: false, message: "start must be on or before end" };
  }
  return {
    ok: true,
    range: { kind: "range", start, end },
  };
}

export type ReportPeriodInput = {
  periodStart: string;
  periodEnd: string;
  linkedinImpressions: number;
  jobPostApplies: number;
};

export type ReportPersonInput = {
  id: string;
  appliedAt: string | null;
  budgetQualified: BudgetQualified;
  allocationStage: AllocationStage | null;
  allocationDecision: AllocationDecision | null;
  noCallAppLink: boolean;
};

export type ReportMeetingInput = {
  id: string;
  personId: string;
  scheduledAt: string;
  outcome: MeetingOutcome;
};

export type ComputeReportInput = {
  range: ReportRange;
  periods: ReportPeriodInput[];
  people: ReportPersonInput[];
  meetings: ReportMeetingInput[];
};

export function isoToZonedDate(
  iso: string,
  timeZone: string = DISPLAY_TIME_ZONE,
): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return zonedIsoDate(date, timeZone);
}

export function addIsoDays(isoDate: string, days: number): string {
  return addCalendarDays(isoDate, days);
}

function weekdayUtc(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay();
}

export function currentWeekRange(
  now: Date = new Date(),
  timeZone: string = DISPLAY_TIME_ZONE,
): { start: string; end: string } {
  const today = zonedIsoDate(now, timeZone);
  const weekday = weekdayUtc(today);
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const start = addIsoDays(today, mondayOffset);
  return { start, end: addIsoDays(start, 4) };
}

export function shiftWeek(
  range: { start: string; end: string },
  weeks: number,
): { start: string; end: string } {
  const days = weeks * 7;
  return {
    start: addIsoDays(range.start, days),
    end: addIsoDays(range.end, days),
  };
}

export function dateInRange(
  isoDate: string | null,
  range: ReportRange,
): boolean {
  if (!isoDate) {
    return false;
  }
  if (range.kind === "all_time") {
    return true;
  }
  return isoDate >= range.start && isoDate <= range.end;
}

export function matchingReportInputs(
  periods: ReportPeriodInput[],
  range: ReportRange,
): ReportPeriodInput[] {
  if (range.kind === "all_time") {
    return periods;
  }
  return periods.filter(
    (period) =>
      period.periodStart === range.start && period.periodEnd === range.end,
  );
}

export function sumReportInputs(periods: ReportPeriodInput[]): {
  linkedinImpressions: number;
  jobPostApplies: number;
} {
  return periods.reduce(
    (sum, period) => ({
      linkedinImpressions: sum.linkedinImpressions + period.linkedinImpressions,
      jobPostApplies: sum.jobPostApplies + period.jobPostApplies,
    }),
    { linkedinImpressions: 0, jobPostApplies: 0 },
  );
}

export function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

export function formatReportRate(rate: number | null): string {
  if (rate === null) {
    return "—";
  }
  return `${(rate * 100).toFixed(1)}%`;
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function reportTableCsv(rows: ReportRow[]): string {
  const header = ["Metric", "Count", "Rate"].join(",");
  const body = rows.map((row) =>
    [csvCell(row.label), String(row.count), csvCell(formatReportRate(row.rate))].join(
      ",",
    ),
  );
  return [header, ...body].join("\n");
}

export function reportTableTsv(rows: ReportRow[]): string {
  const header = ["Metric", "Count", "Rate"].join("\t");
  const body = rows.map((row) =>
    [row.label, String(row.count), formatReportRate(row.rate)].join("\t"),
  );
  return [header, ...body].join("\n");
}

export function reportExportFilename(range: ReportRange): string {
  if (range.kind === "all_time") {
    return "reports-all-time.csv";
  }
  return `reports-${range.start}_${range.end}.csv`;
}

function row(
  id: ReportMetricId,
  count: number,
  rate: number | null,
): ReportRow {
  return {
    id,
    label: REPORT_METRIC_LABELS[id],
    count,
    rate,
    denominator: REPORT_METRIC_DENOMINATORS[id],
  };
}

export function computeReport(input: ComputeReportInput): ReportResponse {
  const { range } = input;
  const linkedin = sumReportInputs(matchingReportInputs(input.periods, range));

  const applicants = input.people.filter((person) =>
    dateInRange(person.appliedAt, range),
  );

  const peopleById = new Map(input.people.map((person) => [person.id, person]));

  const peopleWithMeeting = new Set(
    input.meetings.map((meeting) => meeting.personId),
  );

  const meetingsInRange = input.meetings.filter((meeting) => {
    const zoned = isoToZonedDate(meeting.scheduledAt);
    return dateInRange(zoned, range);
  });

  const meetingsWithOutcome = meetingsInRange.filter((meeting) =>
    MEETING_OUTCOME_DENOMINATOR.has(meeting.outcome),
  );
  const heldPersonIds = new Set(
    meetingsInRange
      .filter((meeting) => meeting.outcome === "held")
      .map((meeting) => meeting.personId),
  );

  const totalApplicants = applicants.length;
  const callsScheduled = applicants.filter((person) =>
    peopleWithMeeting.has(person.id),
  ).length;
  const noCallAppLink = applicants.filter((person) => person.noCallAppLink).length;
  const rejected = applicants.filter(
    (person) => person.allocationStage === "passed",
  ).length;

  const noShows = meetingsWithOutcome.filter(
    (meeting) => meeting.outcome === "no_show",
  ).length;
  const rescheduled = meetingsWithOutcome.filter(
    (meeting) => meeting.outcome === "rescheduled",
  ).length;

  function countHeldPeople(
    predicate: (person: ReportPersonInput) => boolean,
  ): number {
    let count = 0;
    for (const personId of heldPersonIds) {
      const person = peopleById.get(personId);
      if (person && predicate(person)) {
        count += 1;
      }
    }
    return count;
  }

  const qualifiedIncubatorNotBudget = countHeldPeople(
    (person) =>
      person.allocationDecision === "route_incubator" &&
      person.budgetQualified !== "yes",
  );
  const budgetQualifiedIncubator = countHeldPeople(
    (person) =>
      person.allocationDecision === "route_incubator" &&
      person.budgetQualified === "yes",
  );
  const qualifiedForAllocation = countHeldPeople(
    (person) => person.allocationDecision === "allocate",
  );

  const outcomeDenom = meetingsWithOutcome.length;
  const rows: ReportRow[] = [
    row("linkedin_impressions", linkedin.linkedinImpressions, null),
    row(
      "linkedin_applies",
      linkedin.jobPostApplies,
      ratio(linkedin.jobPostApplies, linkedin.linkedinImpressions),
    ),
    row("total_applicants", totalApplicants, totalApplicants === 0 ? null : 1),
    row(
      "calls_scheduled",
      callsScheduled,
      ratio(callsScheduled, totalApplicants),
    ),
    row(
      "no_call_app_link",
      noCallAppLink,
      ratio(noCallAppLink, totalApplicants),
    ),
    row("meetings_with_outcome", outcomeDenom, null),
    row("no_shows", noShows, ratio(noShows, outcomeDenom)),
    row(
      "rescheduled_with_notice",
      rescheduled,
      ratio(rescheduled, outcomeDenom),
    ),
    row(
      "qualified_incubator_not_budget",
      qualifiedIncubatorNotBudget,
      ratio(qualifiedIncubatorNotBudget, outcomeDenom),
    ),
    row(
      "budget_qualified_incubator",
      budgetQualifiedIncubator,
      ratio(budgetQualifiedIncubator, outcomeDenom),
    ),
    row(
      "qualified_for_allocation",
      qualifiedForAllocation,
      ratio(qualifiedForAllocation, outcomeDenom),
    ),
    row("rejected", rejected, ratio(rejected, totalApplicants)),
  ];

  return {
    range,
    rows,
    footnote: REPORT_DENOMINATOR_FOOTNOTE,
  };
}
