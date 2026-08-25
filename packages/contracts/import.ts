import { z } from "zod";
import {
  emailInputSchema,
  leadTempSchema,
  uuidSchema,
  type AllocationDecision,
  type AllocationStage,
  type BudgetQualified,
  type IncubatorStage,
  type LeadTemp,
  type PersonSource,
} from "./enums";
import { DISPLAY_TIME_ZONE, zonedLocalToUtc, type CalendarYmd } from "./time";

export const IMPORT_HEADERS = [
  "name",
  "title",
  "company",
  "location",
  "email",
  "source",
  "resume link",
  "application date",
  "notes",
  "activity",
  "pre-screening",
  "1 meeting",
  "output",
  "2 meeting",
  "budget qualified",
  "lead temp",
  "incubator status",
  "incubator ref",
  "incubator result",
  "routing detail",
  "passed",
  "closed",
  "no close reason",
  "rejection (don't contact again)",
  "rejection reason",
] as const;

const IMPORT_HEADER_SET = new Set<string>(IMPORT_HEADERS);

const IGNORED_HEADERS = new Set(["must-have match", "preferred match"]);

const REQUIRED_HEADERS = ["name", "email"] as const;

export const importRowActionSchema = z.enum(["create", "update", "skip"]);
export type ImportRowAction = z.infer<typeof importRowActionSchema>;

export const importFileBodySchema = z.object({
  filename: z.string().trim().min(1).max(512),
  content: z.string().max(5_000_000),
});
export type ImportFileBody = z.infer<typeof importFileBodySchema>;

export const importPreviewRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  action: importRowActionSchema,
  email: z.string().nullable(),
  name: z.string().nullable(),
  existingPersonId: uuidSchema.nullable(),
  errors: z.array(z.string()),
});
export type ImportPreviewRow = z.infer<typeof importPreviewRowSchema>;

export const importPreviewCountsSchema = z.object({
  create: z.number().int().nonnegative(),
  update: z.number().int().nonnegative(),
  skip: z.number().int().nonnegative(),
});
export type ImportPreviewCounts = z.infer<typeof importPreviewCountsSchema>;

export const importPreviewResponseSchema = z.object({
  filename: z.string(),
  rows: z.array(importPreviewRowSchema),
  counts: importPreviewCountsSchema,
});
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;

export const importCommitResponseSchema = z.object({
  filename: z.string(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type ImportCommitResponse = z.infer<typeof importCommitResponseSchema>;

export type ImportPersonFields = {
  firstName: string;
  lastName: string;
  email: string;
  title: string | null;
  company: string | null;
  location: string | null;
  source: PersonSource;
  resumeUrl: string | null;
  appliedAt: string | null;
  notes: string | null;
  leadTemp: LeadTemp | null;
  budgetQualified: BudgetQualified;
};

export type ImportMeetingPlan = {
  scheduledAt: string;
};

export type ImportActivityPlan = {
  occurredAt: string;
  text: string;
};

export type ImportIncubatorSignals = {
  statusRoutedAt: string | null;
  applicationRef: string | null;
  applicationResult: string | null;
  routingDetail: string | null;
  closed: boolean;
  closeReason: string | null;
};

export type ImportMappedRow = {
  rowNumber: number;
  errors: string[];
  displayName: string | null;
  person: ImportPersonFields | null;
  contacted: boolean;
  activity: ImportActivityPlan | null;
  meetings: ImportMeetingPlan[];
  incubator: ImportIncubatorSignals;
  passed: boolean;
  rejection: boolean;
  rejectionReason: string | null;
};

export type ImportExistingPerson = {
  id: string;
  email: string;
  deletedAt: string | null;
};

export type ImportAllocationPlan = {
  stage: AllocationStage;
  decision: AllocationDecision | null;
  passReason: string | null;
  doNotContact: boolean;
};

export type ImportIncubatorExisting = {
  stage: IncubatorStage;
  routedAt: string;
  applicationRef: string | null;
  applicationResult: string | null;
  routingDetail: string | null;
  closeReason: string | null;
  closedAt: string | null;
};

export type ImportParseResult =
  | { ok: true; records: Array<{ rowNumber: number; values: Record<string, string> }> }
  | { ok: false; message: string };

const ALLOCATION_STAGE_RANK: Record<AllocationStage, number> = {
  applied: 0,
  contacted: 1,
  in_conversation: 2,
  decision: 3,
  nurture: 4,
  allocated: 4,
  passed: 4,
};

const INCUBATOR_STAGE_RANK: Record<IncubatorStage, number> = {
  routed: 0,
  application_sent: 1,
  application_received: 2,
  offer_made: 3,
  paid: 4,
  enrolled: 5,
  closed: 6,
};

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE_IN_TEXT_RE = /\d{4}-\d{2}-\d{2}/;
const US_DATE_IN_TEXT_RE = /\d{1,2}\/\d{1,2}\/\d{4}/;
const MEETING_RE =
  /(?:meeting\s+)?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*(?:pt|pdt|pst))?/i;

export function importSourceFilename(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, "").trim();
  return base.length > 0 ? base.slice(0, 255) : "spreadsheet.csv";
}

export function normalizeImportHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/\s+/g, " ");
}

export function detectSpreadsheetDelimiter(
  content: string,
  filename: string,
): "," | "\t" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".tsv") || lower.endsWith(".tab")) {
    return "\t";
  }
  if (lower.endsWith(".csv")) {
    return ",";
  }
  const first =
    content
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .find((line) => line.trim()) ?? "";
  const tabs = (first.match(/\t/g) ?? []).length;
  const commas = (first.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

export function parseDelimitedRows(
  text: string,
  delimiter: string,
): Array<{ line: number; cells: string[] }> {
  const src = text.replace(/^\uFEFF/, "");
  const rows: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const isEmptyRow = (values: string[]): boolean =>
    values.every((value) => value.trim() === "");

  const commitRow = () => {
    if (!isEmptyRow(cells)) {
      rows.push({ line: rowStartLine, cells });
    }
    cells = [];
    rowStartLine = line;
  };

  for (let i = 0; i < src.length; i += 1) {
    const char = src[i] ?? "";
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") {
          line += 1;
        }
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      cells.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && src[i + 1] === "\n") {
        i += 1;
      }
      cells.push(field);
      field = "";
      line += 1;
      commitRow();
      continue;
    }
    field += char;
  }

  cells.push(field);
  commitRow();
  return rows;
}

export function parseImportFile(
  filename: string,
  content: string,
): ImportParseResult {
  const trimmed = content.replace(/^\uFEFF/, "");
  if (trimmed.trim().length === 0) {
    return { ok: false, message: "Spreadsheet is empty" };
  }

  const delimiter = detectSpreadsheetDelimiter(trimmed, filename);
  const rows = parseDelimitedRows(trimmed, delimiter);
  const headerRow = rows[0];
  if (!headerRow) {
    return { ok: false, message: "Spreadsheet is empty" };
  }

  const indexByHeader = new Map<string, number>();
  for (let i = 0; i < headerRow.cells.length; i += 1) {
    const header = normalizeImportHeader(headerRow.cells[i] ?? "");
    if (!header || IGNORED_HEADERS.has(header)) {
      continue;
    }
    if (IMPORT_HEADER_SET.has(header) && !indexByHeader.has(header)) {
      indexByHeader.set(header, i);
    }
  }

  const missing = REQUIRED_HEADERS.filter((header) => !indexByHeader.has(header));
  if (missing.length > 0) {
    const label = missing[0] === "name" ? "Name" : "Email";
    return { ok: false, message: `Missing required header: ${label}` };
  }

  const records = rows.slice(1).map((row) => {
    const values: Record<string, string> = {};
    for (const header of IMPORT_HEADERS) {
      const index = indexByHeader.get(header);
      values[header] = index === undefined ? "" : (row.cells[index] ?? "").trim();
    }
    return { rowNumber: row.line, values };
  });

  return { ok: true, records };
}

export function splitName(
  name: string,
): { firstName: string; lastName: string } | { error: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return { error: "Name is required" };
  }
  const space = trimmed.lastIndexOf(" ");
  if (space <= 0 || space === trimmed.length - 1) {
    return { error: "Name must include first and last name" };
  }
  return {
    firstName: trimmed.slice(0, space),
    lastName: trimmed.slice(space + 1),
  };
}

export function mapPersonSource(raw: string): PersonSource {
  const value = raw.trim().toLowerCase();
  if (value === "linkedin") {
    return "linkedin";
  }
  if (value === "workable") {
    return "workable";
  }
  return "other";
}

export function parseCalendarDate(text: string): CalendarYmd | null {
  const trimmed = text.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = ISO_DATE_RE.exec(trimmed);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const us = US_DATE_RE.exec(trimmed);
    if (!us) {
      return null;
    }
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3]);
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function extractCalendarDate(text: string): CalendarYmd | null {
  const iso = text.match(ISO_DATE_IN_TEXT_RE);
  if (iso?.[0]) {
    const parsed = parseCalendarDate(iso[0]);
    if (parsed) {
      return parsed;
    }
  }
  const us = text.match(US_DATE_IN_TEXT_RE);
  if (us?.[0]) {
    return parseCalendarDate(us[0]);
  }
  return null;
}

export function startOfDayIso(ymd: CalendarYmd): string {
  return zonedLocalToUtc(ymd, DISPLAY_TIME_ZONE).toISOString();
}

export function isoDateFromYmd(ymd: CalendarYmd): string {
  const month = String(ymd.month).padStart(2, "0");
  const day = String(ymd.day).padStart(2, "0");
  return `${ymd.year}-${month}-${day}`;
}

function parseAmPmTime(
  hourRaw: number,
  minuteRaw: number,
  mer: string,
): { hours: number; minutes: number } | null {
  if (hourRaw < 1 || hourRaw > 12 || minuteRaw > 59) {
    return null;
  }
  let hours = hourRaw;
  if (mer.toLowerCase() === "am") {
    if (hours === 12) {
      hours = 0;
    }
  } else if (hours !== 12) {
    hours += 12;
  }
  return { hours, minutes: minuteRaw };
}

export function parseMeetingCell(
  value: string,
): { scheduledAt: string } | { error: string } | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = MEETING_RE.exec(trimmed);
  if (!match) {
    return { error: `Could not parse meeting: ${trimmed}` };
  }
  const ymd = parseCalendarDate(match[1] ?? "");
  const time = parseAmPmTime(
    Number(match[2]),
    match[3] ? Number(match[3]) : 0,
    match[4] ?? "am",
  );
  if (!ymd || !time) {
    return { error: `Could not parse meeting: ${trimmed}` };
  }
  return {
    scheduledAt: zonedLocalToUtc(
      ymd,
      DISPLAY_TIME_ZONE,
      time.hours,
      time.minutes,
    ).toISOString(),
  };
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isBlankText(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

function isFlagSet(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return !["false", "0"].includes(trimmed.toLowerCase());
}

function parseBudgetQualified(
  value: string,
): BudgetQualified | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return "unknown";
  }
  const lower = trimmed.toLowerCase();
  if (lower === "yes" || lower === "y" || lower === "true") {
    return "yes";
  }
  if (lower === "no" || lower === "n" || lower === "false") {
    return "no";
  }
  return { error: `Invalid Budget Qualified: ${trimmed}` };
}

function parseLeadTemp(value: string): LeadTemp | null | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = leadTempSchema.safeParse(trimmed.toLowerCase());
  if (!parsed.success) {
    return { error: `Invalid Lead Temp: ${trimmed}` };
  }
  return parsed.data;
}

function parseResumeUrl(value: string): string | null | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = z.url().safeParse(trimmed);
  if (!parsed.success) {
    return { error: `Invalid Resume Link: ${trimmed}` };
  }
  return parsed.data;
}

export function mapImportRow(
  rowNumber: number,
  values: Record<string, string>,
): ImportMappedRow {
  const errors: string[] = [];
  const displayName = nullableText(values.name ?? "");

  // TODO: Pre-Screening and Output columns are accepted and ignored.

  const name = splitName(values.name ?? "");
  const emailParsed = emailInputSchema.safeParse(values.email ?? "");
  if ("error" in name) {
    errors.push(name.error);
  }
  if (!emailParsed.success) {
    errors.push("Valid email is required");
  }

  const appliedRaw = values["application date"] ?? "";
  let appliedAt: string | null = null;
  if (appliedRaw.trim()) {
    const ymd = parseCalendarDate(appliedRaw);
    if (!ymd) {
      errors.push(`Invalid Application Date: ${appliedRaw.trim()}`);
    } else {
      appliedAt = isoDateFromYmd(ymd);
    }
  }

  const resume = parseResumeUrl(values["resume link"] ?? "");
  if (resume && typeof resume === "object" && "error" in resume) {
    errors.push(resume.error);
  }

  const budget = parseBudgetQualified(values["budget qualified"] ?? "");
  if (typeof budget === "object" && "error" in budget) {
    errors.push(budget.error);
  }

  const leadTemp = parseLeadTemp(values["lead temp"] ?? "");
  if (leadTemp && typeof leadTemp === "object" && "error" in leadTemp) {
    errors.push(leadTemp.error);
  }

  const activityRaw = values.activity ?? "";
  let contacted = false;
  let activity: ImportActivityPlan | null = null;
  if (activityRaw.trim()) {
    const ymd = extractCalendarDate(activityRaw);
    if (!ymd) {
      errors.push(`Could not parse Activity date: ${activityRaw.trim()}`);
    } else {
      contacted = true;
      activity = { occurredAt: startOfDayIso(ymd), text: activityRaw.trim() };
    }
  }

  const meetings: ImportMeetingPlan[] = [];
  for (const column of ["1 meeting", "2 meeting"] as const) {
    const parsed = parseMeetingCell(values[column] ?? "");
    if (!parsed) {
      continue;
    }
    if ("error" in parsed) {
      errors.push(parsed.error);
    } else {
      meetings.push({ scheduledAt: parsed.scheduledAt });
    }
  }

  const incubatorStatus = values["incubator status"] ?? "";
  let statusRoutedAt: string | null = null;
  if (incubatorStatus.trim()) {
    const ymd = extractCalendarDate(incubatorStatus);
    if (!ymd) {
      errors.push(
        `Could not parse Incubator Status date: ${incubatorStatus.trim()}`,
      );
    } else {
      statusRoutedAt = startOfDayIso(ymd);
    }
  }

  const closed = isFlagSet(values.closed ?? "");
  const closeReason = nullableText(values["no close reason"] ?? "");
  if (closed && !closeReason) {
    errors.push("No close reason is required when Closed is set");
  }

  const rejection = isFlagSet(values["rejection (don't contact again)"] ?? "");
  const rejectionReason = nullableText(values["rejection reason"] ?? "");
  if (rejection && !rejectionReason) {
    errors.push("Rejection Reason is required when Rejection is set");
  }

  const person: ImportPersonFields | null =
    !("error" in name) && emailParsed.success
      ? {
          firstName: name.firstName,
          lastName: name.lastName,
          email: emailParsed.data,
          title: nullableText(values.title ?? ""),
          company: nullableText(values.company ?? ""),
          location: nullableText(values.location ?? ""),
          source: mapPersonSource(values.source ?? ""),
          resumeUrl: typeof resume === "string" ? resume : null,
          appliedAt,
          notes: nullableText(values.notes ?? ""),
          leadTemp: typeof leadTemp === "string" ? leadTemp : null,
          budgetQualified: typeof budget === "string" ? budget : "unknown",
        }
      : null;

  return {
    rowNumber,
    errors,
    displayName,
    person,
    contacted,
    activity,
    meetings,
    incubator: {
      statusRoutedAt,
      applicationRef: nullableText(values["incubator ref"] ?? ""),
      applicationResult: nullableText(values["incubator result"] ?? ""),
      routingDetail: nullableText(values["routing detail"] ?? ""),
      closed,
      closeReason,
    },
    passed: isFlagSet(values.passed ?? ""),
    rejection,
    rejectionReason,
  };
}

export function mapImportRecords(
  records: Array<{ rowNumber: number; values: Record<string, string> }>,
): ImportMappedRow[] {
  return records.map((record) => mapImportRow(record.rowNumber, record.values));
}

export function previewImportCounts(
  rows: readonly ImportPreviewRow[],
): ImportPreviewCounts {
  const counts: ImportPreviewCounts = { create: 0, update: 0, skip: 0 };
  for (const row of rows) {
    counts[row.action] += 1;
  }
  return counts;
}

export function assignImportActions(
  rows: ImportMappedRow[],
  existing: readonly ImportExistingPerson[],
): ImportPreviewRow[] {
  const byEmail = new Map(
    existing.map((person) => [person.email.toLowerCase(), person] as const),
  );
  const seen = new Set<string>();

  return rows.map((row) => {
    const errors = [...row.errors];
    const email = row.person?.email ?? null;
    const name = row.displayName;
    if (!row.person || !email) {
      return {
        rowNumber: row.rowNumber,
        action: "skip" as const,
        email,
        name,
        existingPersonId: null,
        errors: errors.length > 0 ? errors : ["Valid email is required"],
      };
    }

    if (seen.has(email)) {
      errors.push("Duplicate email in file");
      return {
        rowNumber: row.rowNumber,
        action: "skip" as const,
        email,
        name,
        existingPersonId: byEmail.get(email)?.id ?? null,
        errors,
      };
    }

    if (errors.length > 0) {
      return {
        rowNumber: row.rowNumber,
        action: "skip" as const,
        email,
        name,
        existingPersonId: byEmail.get(email)?.id ?? null,
        errors,
      };
    }

    seen.add(email);
    const found = byEmail.get(email);
    if (found?.deletedAt) {
      return {
        rowNumber: row.rowNumber,
        action: "skip" as const,
        email,
        name,
        existingPersonId: found.id,
        errors: ["Email matches a deleted person"],
      };
    }

    if (found) {
      return {
        rowNumber: row.rowNumber,
        action: "update" as const,
        email,
        name,
        existingPersonId: found.id,
        errors: [],
      };
    }

    return {
      rowNumber: row.rowNumber,
      action: "create" as const,
      email,
      name,
      existingPersonId: null,
      errors: [],
    };
  });
}

export function atLeastAllocationStage(
  current: AllocationStage,
  min: AllocationStage,
): AllocationStage {
  return ALLOCATION_STAGE_RANK[current] >= ALLOCATION_STAGE_RANK[min]
    ? current
    : min;
}

export function atLeastIncubatorStage(
  current: IncubatorStage,
  min: IncubatorStage,
): IncubatorStage {
  return INCUBATOR_STAGE_RANK[current] >= INCUBATOR_STAGE_RANK[min]
    ? current
    : min;
}

export function planImportAllocation(input: {
  existingStage: AllocationStage | null;
  existingDecision: AllocationDecision | null;
  existingPassReason: string | null;
  existingDoNotContact: boolean;
  contacted: boolean;
  hasMeeting: boolean;
  incubator: boolean;
  passed: boolean;
  rejection: boolean;
  rejectionReason: string | null;
}): ImportAllocationPlan {
  let stage: AllocationStage = input.existingStage ?? "applied";
  if (input.contacted) {
    stage = atLeastAllocationStage(stage, "contacted");
  }
  if (input.hasMeeting) {
    stage = atLeastAllocationStage(stage, "in_conversation");
  }

  let decision = input.existingDecision;
  let passReason = input.existingPassReason;
  const doNotContact = input.existingDoNotContact || input.rejection;

  if (input.incubator && !input.passed && !input.rejection) {
    decision = "route_incubator";
  }

  if (input.passed && !input.rejection) {
    stage = "allocated";
    decision = "allocate";
    passReason = null;
  }

  if (input.rejection) {
    stage = "passed";
    decision = "pass";
    passReason = input.rejectionReason;
  }

  return { stage, decision, passReason, doNotContact };
}

export function hasIncubatorImportSignal(
  signals: ImportIncubatorSignals,
): boolean {
  return Boolean(
    signals.statusRoutedAt || signals.applicationRef || signals.closed,
  );
}

export function planImportIncubator(
  existing: ImportIncubatorExisting | null,
  signals: ImportIncubatorSignals,
  nowIso: string,
): ImportIncubatorExisting | null {
  if (!hasIncubatorImportSignal(signals)) {
    return null;
  }

  let stage: IncubatorStage = existing?.stage ?? "application_sent";
  if (!existing && signals.statusRoutedAt) {
    stage = "application_sent";
  }
  if (signals.applicationRef) {
    stage = atLeastIncubatorStage(stage, "application_received");
  }
  if (signals.closed) {
    stage = "closed";
  }

  return {
    stage,
    routedAt: existing?.routedAt ?? signals.statusRoutedAt ?? nowIso,
    applicationRef: isBlankText(existing?.applicationRef)
      ? signals.applicationRef
      : (existing?.applicationRef ?? null),
    applicationResult: isBlankText(existing?.applicationResult)
      ? signals.applicationResult
      : (existing?.applicationResult ?? null),
    routingDetail: isBlankText(existing?.routingDetail)
      ? signals.routingDetail
      : (existing?.routingDetail ?? null),
    closeReason:
      stage === "closed"
        ? (signals.closeReason ?? existing?.closeReason ?? null)
        : (existing?.closeReason ?? null),
    closedAt:
      stage === "closed" ? (existing?.closedAt ?? nowIso) : null,
  };
}

export function fillBlankPersonFields(
  existing: ImportPersonFields,
  incoming: ImportPersonFields,
): ImportPersonFields {
  return {
    firstName: existing.firstName,
    lastName: existing.lastName,
    email: existing.email,
    title: isBlankText(existing.title) ? incoming.title : existing.title,
    company: isBlankText(existing.company) ? incoming.company : existing.company,
    location: isBlankText(existing.location)
      ? incoming.location
      : existing.location,
    source: existing.source,
    resumeUrl: isBlankText(existing.resumeUrl)
      ? incoming.resumeUrl
      : existing.resumeUrl,
    appliedAt: isBlankText(existing.appliedAt)
      ? incoming.appliedAt
      : existing.appliedAt,
    notes: isBlankText(existing.notes) ? incoming.notes : existing.notes,
    leadTemp: existing.leadTemp === null ? incoming.leadTemp : existing.leadTemp,
    budgetQualified:
      existing.budgetQualified === "unknown"
        ? incoming.budgetQualified
        : existing.budgetQualified,
  };
}

export function personFieldsChanged(
  before: ImportPersonFields,
  after: ImportPersonFields,
): boolean {
  return (
    before.title !== after.title ||
    before.company !== after.company ||
    before.location !== after.location ||
    before.resumeUrl !== after.resumeUrl ||
    before.appliedAt !== after.appliedAt ||
    before.notes !== after.notes ||
    before.leadTemp !== after.leadTemp ||
    before.budgetQualified !== after.budgetQualified
  );
}
