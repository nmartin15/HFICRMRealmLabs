import { describe, expect, it } from "vitest";
import {
  assignImportActions,
  atLeastAllocationStage,
  detectSpreadsheetDelimiter,
  fillBlankPersonFields,
  hasIncubatorImportSignal,
  mapImportRecords,
  mapPersonSource,
  parseImportFile,
  parseMeetingCell,
  planImportAllocation,
  planImportIncubator,
  previewImportCounts,
  splitName,
  startOfDayIso,
  type ImportExistingPerson,
  type ImportPersonFields,
} from "./import";

const HEADERS = [
  "Name",
  "Title",
  "Company",
  "Location",
  "Email",
  "Source",
  "Resume Link",
  "Application Date",
  "Notes",
  "Activity",
  "Pre-Screening",
  "1 Meeting",
  "Output",
  "2 Meeting",
  "Budget Qualified",
  "Lead Temp",
  "Incubator Status",
  "Incubator Ref",
  "Incubator Result",
  "Routing Detail",
  "Passed",
  "Closed",
  "No close reason",
  "Rejection (Don't contact again)",
  "Rejection Reason",
  "Must-Have Match",
  "Preferred Match",
];

function csv(
  rows: Array<Partial<Record<(typeof HEADERS)[number], string>>>,
  headerOrder: string[] = HEADERS,
): string {
  const escape = (value: string): string => {
    if (/[",\n]/.test(value)) {
      return `"${value.replaceAll('"', '""')}"`;
    }
    return value;
  };
  const lines = [
    headerOrder.join(","),
    ...rows.map((row) =>
      headerOrder
        .map((header) => escape(row[header as (typeof HEADERS)[number]] ?? ""))
        .join(","),
    ),
  ];
  return lines.join("\n");
}

function mappedFromCsv(content: string, filename = "applicants.csv") {
  const parsed = parseImportFile(filename, content);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return mapImportRecords(parsed.records);
}

const blankPerson: ImportPersonFields = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  title: null,
  company: null,
  location: null,
  source: "other",
  resumeUrl: null,
  appliedAt: null,
  notes: null,
  leadTemp: null,
  budgetQualified: "unknown",
};

describe("spreadsheet parsing", () => {
  it("accepts CSV or TSV with case-insensitive, order-free headers", () => {
    const shuffled = [
      "email",
      "SOURCE",
      "name",
      "Title",
    ];
    const content = `${shuffled.join(",")}\njane@x.com,LinkedIn,Jane Doe,Engineer`;
    const parsed = parseImportFile("sheet.csv", content);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const [row] = mapImportRecords(parsed.records);
    expect(row?.person?.email).toBe("jane@x.com");
    expect(row?.person?.firstName).toBe("Jane");
    expect(row?.person?.lastName).toBe("Doe");
    expect(row?.person?.source).toBe("linkedin");
    expect(row?.person?.title).toBe("Engineer");
  });

  it("detects TSV from filename and tab-separated content", () => {
    expect(detectSpreadsheetDelimiter("a\tb\n", "file.tsv")).toBe("\t");
    expect(detectSpreadsheetDelimiter("a,b\n", "file.csv")).toBe(",");
    const tsv = "Name\tEmail\nJane Doe\tjane@x.com";
    const parsed = parseImportFile("applicants.tsv", tsv);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(mapImportRecords(parsed.records)[0]?.person?.email).toBe(
      "jane@x.com",
    );
  });

  it("parses quoted CSV fields and ignores Must-Have / Preferred Match", () => {
    const content = csv([
      {
        Name: "Jane Doe",
        Email: "jane@x.com",
        Company: "Acme, Inc",
        "Must-Have Match": "99",
        "Preferred Match": "12",
      },
    ]);
    const [row] = mappedFromCsv(content);
    expect(row?.person?.company).toBe("Acme, Inc");
    expect(row?.errors).toEqual([]);
  });

  it("parses the live applicant sheet headers and meeting/activity cells", () => {
    const header = [
      "Name",
      "Title",
      "Company",
      "Location",
      "Email",
      "Source",
      "Resume Link",
      "Application Date",
      "Notes",
      "Activity",
      "Preliminary Questions",
      "1 Meeting",
      "Output",
      "Notes from 1 meeting",
      "Follow Up After 1 Meeting",
      "2 Meeting",
      "Notes",
      "Budget Qualified",
      "Lead Temp",
      "Incubator Status",
      "Incubator Ref",
      "Incubator Result",
      "Routing Detail",
      "Application Follow Up",
      "Passed",
      "Closed",
      "No close reason",
      "Rejection (Don't contact again)",
      "Rejection Reason",
    ].join("\t");
    const row = [
      "Jane Doe",
      "Quantitative Researcher",
      "",
      "Paris, France",
      "jane.sheet@example.com",
      "Workable",
      "https://example.com/resume",
      "2026-08-13",
      "",
      "Contacted 2026-08-18",
      "",
      "Meeting 2026-08-24 6pm PT",
      "rescheduled with notice",
      "Sent track record questions",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ].join("\t");
    const parsed = parseImportFile("applicants.tsv", `${header}\n${row}`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const [mapped] = mapImportRecords(parsed.records);
    expect(mapped?.errors).toEqual([]);
    expect(mapped?.person?.email).toBe("jane.sheet@example.com");
    expect(mapped?.contacted).toBe(true);
    expect(mapped?.tasks).toEqual([
      {
        kind: "meeting",
        dueAt: "2026-08-25T01:00:00.000Z",
        notes: "Sent track record questions",
        status: "rescheduled",
      },
    ]);
  });

  it("rejects a file missing Name or Email headers", () => {
    expect(parseImportFile("x.csv", "Title,Email\nX,a@b.com").ok).toBe(false);
    expect(parseImportFile("x.csv", "Name,Title\nJane Doe,X").ok).toBe(false);
    expect(parseImportFile("x.csv", "   ").ok).toBe(false);
  });
});

describe("field mapping", () => {
  it("splits Name on the last space", () => {
    expect(splitName("Mary Ann Smith")).toEqual({
      firstName: "Mary Ann",
      lastName: "Smith",
    });
    expect(splitName("Jane")).toEqual({
      error: "Name must include first and last name",
    });
  });

  it("lowercases email and maps source", () => {
    const [row] = mappedFromCsv(
      csv([{ Name: "Jane Doe", Email: "Jane@X.COM", Source: "Workable" }]),
    );
    expect(row?.person?.email).toBe("jane@x.com");
    expect(mapPersonSource("LinkedIn")).toBe("linkedin");
    expect(mapPersonSource("Workable")).toBe("workable");
    expect(mapPersonSource("Referral")).toBe("referral");
    expect(row?.person?.source).toBe("workable");
  });

  it("maps budget qualified and lead temp, including blanks", () => {
    const [yesHot] = mappedFromCsv(
      csv([
        {
          Name: "Jane Doe",
          Email: "jane@x.com",
          "Budget Qualified": "yes",
          "Lead Temp": "hot",
        },
      ]),
    );
    const [blank] = mappedFromCsv(
      csv([{ Name: "John Smith", Email: "john@x.com" }]),
    );
    expect(yesHot?.person?.budgetQualified).toBe("light");
    expect(yesHot?.person?.leadTemp).toBe("hot");
    expect(blank?.person?.budgetQualified).toBe("unknown");
    expect(blank?.person?.leadTemp).toBeNull();
  });

  it("stores Activity as a timeline note without marking contacted", () => {
    const [row] = mappedFromCsv(
      csv([
        {
          Name: "Jane Doe",
          Email: "jane@x.com",
          Activity: "Contacted 2026-08-18",
        },
      ]),
    );
    expect(row?.contacted).toBe(false);
    expect(row?.activity?.occurredAt).toBe("2026-08-18T07:00:00.000Z");
    expect(startOfDayIso({ year: 2026, month: 8, day: 18 })).toBe(
      "2026-08-18T07:00:00.000Z",
    );
  });

  it("parses 1 Meeting and 2 Meeting in America/Los_Angeles", () => {
    const meeting = parseMeetingCell("Meeting 2026-08-31 11am PT");
    expect(meeting).toEqual({ scheduledAt: "2026-08-31T18:00:00.000Z" });
    const winter = parseMeetingCell("Meeting 2026-12-15 11am PT");
    expect(winter).toEqual({ scheduledAt: "2026-12-15T19:00:00.000Z" });

    const [row] = mappedFromCsv(
      csv([
        {
          Name: "Jane Doe",
          Email: "jane@x.com",
          "1 Meeting": "Meeting 2026-08-31 11am PT",
          "2 Meeting": "Meeting 2026-09-02 2:30pm PT",
        },
      ]),
    );
    expect(row?.tasks).toEqual([
      {
        kind: "meeting",
        dueAt: "2026-08-31T18:00:00.000Z",
        notes: null,
        status: "open",
      },
      {
        kind: "meeting",
        dueAt: "2026-09-02T21:30:00.000Z",
        notes: null,
        status: "open",
      },
    ]);
  });

  it("creates incubator signals from status, ref, and close reason", () => {
    const [row] = mappedFromCsv(
      csv([
        {
          Name: "Jane Doe",
          Email: "jane@x.com",
          "Incubator Status": "Sent 2026-08-23",
          "Incubator Ref": "APP-9",
          Closed: "TRUE",
          "No close reason": "Withdrew",
        },
      ]),
    );
    expect(row?.incubator.statusRoutedAt).toBe("2026-08-23T07:00:00.000Z");
    expect(row?.incubator.applicationRef).toBe("APP-9");
    expect(row?.incubator.closed).toBe(true);
    expect(row?.incubator.closeReason).toBe("Withdrew");
    expect(hasIncubatorImportSignal(row?.incubator ?? {
      statusRoutedAt: null,
      statusStage: null,
      applicationRef: null,
      applicationResult: null,
      routingDetail: null,
      closed: false,
      closeReason: null,
    })).toBe(true);
  });

  it("requires close reason and rejection reason when those flags are set", () => {
    const [closed] = mappedFromCsv(
      csv([{ Name: "Jane Doe", Email: "jane@x.com", Closed: "yes" }]),
    );
    const [rejected] = mappedFromCsv(
      csv([
        {
          Name: "John Smith",
          Email: "john@x.com",
          "Rejection (Don't contact again)": "TRUE",
        },
      ]),
    );
    expect(closed?.errors).toContain(
      "No close reason is required when Closed is set",
    );
    expect(rejected?.errors).toContain(
      "Rejection Reason is required when Rejection is set",
    );
  });
});

describe("preview actions", () => {
  it("dedupes on email and marks create, update, or skip", () => {
    const rows = mappedFromCsv(
      csv([
        { Name: "Jane Doe", Email: "jane@x.com" },
        { Name: "Jane Duplicate", Email: "JANE@x.com" },
        { Name: "Solo" },
        { Name: "Ada Lovelace", Email: "ada@example.com" },
      ]),
    );
    const existing: ImportExistingPerson[] = [
      { id: "11111111-1111-4111-8111-111111111111", email: "ada@example.com", deletedAt: null },
    ];
    const preview = assignImportActions(rows, existing);
    expect(preview.map((row) => row.action)).toEqual([
      "create",
      "skip",
      "skip",
      "update",
    ]);
    expect(preview[1]?.errors).toContain("Duplicate email in file");
    expect(preview[2]?.errors.length).toBeGreaterThan(0);
    expect(previewImportCounts(preview)).toEqual({
      create: 1,
      update: 1,
      skip: 2,
    });
  });

  it("skips deleted people", () => {
    const rows = mappedFromCsv(
      csv([{ Name: "Ada Lovelace", Email: "ada@example.com" }]),
    );
    const preview = assignImportActions(rows, [
      {
        id: "11111111-1111-4111-8111-111111111111",
        email: "ada@example.com",
        deletedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
    expect(preview[0]?.action).toBe("skip");
    expect(preview[0]?.errors).toContain("Email matches a deleted person");
  });
});

describe("allocation and incubator planning", () => {
  it("raises stage to at least contacted or in_conversation without downgrading", () => {
    expect(atLeastAllocationStage("applied", "contacted")).toBe("contacted");
    expect(atLeastAllocationStage("decision", "contacted")).toBe("decision");
    expect(atLeastAllocationStage("allocated", "in_conversation")).toBe(
      "allocated",
    );

    const contacted = planImportAllocation({
      existingStage: "applied",
      existingDecision: null,
      existingPassReason: null,
      existingDoNotContact: false,
      contacted: true,
      hasMeeting: false,
      incubator: false,
      passed: false,
      rejection: false,
      rejectionReason: null,
    });
    expect(contacted.stage).toBe("contacted");

    const meeting = planImportAllocation({
      existingStage: "applied",
      existingDecision: null,
      existingPassReason: null,
      existingDoNotContact: false,
      contacted: true,
      hasMeeting: true,
      incubator: false,
      passed: false,
      rejection: false,
      rejectionReason: null,
    });
    expect(meeting.stage).toBe("in_conversation");
  });

  it("routes incubator, allocates Passed, and passes Rejection", () => {
    const routed = planImportAllocation({
      existingStage: "contacted",
      existingDecision: null,
      existingPassReason: null,
      existingDoNotContact: false,
      contacted: true,
      hasMeeting: true,
      incubator: true,
      passed: false,
      rejection: false,
      rejectionReason: null,
    });
    expect(routed.decision).toBe("route_incubator");
    expect(routed.stage).toBe("in_conversation");

    const allocated = planImportAllocation({
      existingStage: "applied",
      existingDecision: null,
      existingPassReason: null,
      existingDoNotContact: false,
      contacted: false,
      hasMeeting: false,
      incubator: false,
      passed: true,
      rejection: false,
      rejectionReason: null,
    });
    expect(allocated.stage).toBe("passed");
    expect(allocated.decision).toBe("pass");

    const rejected = planImportAllocation({
      existingStage: "applied",
      existingDecision: null,
      existingPassReason: null,
      existingDoNotContact: false,
      contacted: false,
      hasMeeting: false,
      incubator: true,
      passed: true,
      rejection: true,
      rejectionReason: "Not a fit",
    });
    expect(rejected.stage).toBe("passed");
    expect(rejected.decision).toBe("pass");
    expect(rejected.doNotContact).toBe(true);
    expect(rejected.passReason).toBe("Not a fit");
  });

  it("creates an incubator card at application_sent and advances on ref or closed", () => {
    const sent = planImportIncubator(
      null,
      {
        statusRoutedAt: "2026-08-23T07:00:00.000Z",
        statusStage: "sent",
        applicationRef: null,
        applicationResult: null,
        routingDetail: "warm intro",
        closed: false,
        closeReason: null,
      },
      "2026-08-24T00:00:00.000Z",
    );
    expect(sent?.stage).toBe("sent");
    expect(sent?.routedAt).toBe("2026-08-23T07:00:00.000Z");
    expect(sent?.routingDetail).toBe("warm intro");

    const received = planImportIncubator(
      sent,
      {
        statusRoutedAt: "2026-08-23T07:00:00.000Z",
        statusStage: "sent",
        applicationRef: "APP-9",
        applicationResult: "ok",
        routingDetail: null,
        closed: false,
        closeReason: null,
      },
      "2026-08-24T00:00:00.000Z",
    );
    expect(received?.stage).toBe("applied");
    expect(received?.applicationRef).toBe("APP-9");
    expect(received?.routingDetail).toBe("warm intro");

    const closed = planImportIncubator(
      received,
      {
        statusRoutedAt: null,
        statusStage: null,
        applicationRef: null,
        applicationResult: null,
        routingDetail: null,
        closed: true,
        closeReason: "Withdrew",
      },
      "2026-08-24T00:00:00.000Z",
    );
    expect(closed?.stage).toBe("rejected");
    expect(closed?.closeReason).toBe("Withdrew");
    expect(closed?.closedAt).toBe("2026-08-24T00:00:00.000Z");
  });
});

describe("update blank fields only", () => {
  it("fills empty person fields and leaves populated ones alone", () => {
    const existing: ImportPersonFields = {
      ...blankPerson,
      title: "Engineer",
      budgetQualified: "light",
      leadTemp: "warm",
    };
    const incoming: ImportPersonFields = {
      ...blankPerson,
      firstName: "Ignored",
      lastName: "Name",
      title: "CEO",
      company: "Acme",
      source: "linkedin",
      budgetQualified: "not_qualified",
      leadTemp: "hot",
      notes: "hello",
    };
    const merged = fillBlankPersonFields(existing, incoming);
    expect(merged.firstName).toBe("Ada");
    expect(merged.lastName).toBe("Lovelace");
    expect(merged.title).toBe("Engineer");
    expect(merged.company).toBe("Acme");
    expect(merged.source).toBe("other");
    expect(merged.budgetQualified).toBe("light");
    expect(merged.leadTemp).toBe("warm");
    expect(merged.notes).toBe("hello");
  });

  it("treats unknown budget qualified as blank", () => {
    const merged = fillBlankPersonFields(blankPerson, {
      ...blankPerson,
      budgetQualified: "light",
    });
    expect(merged.budgetQualified).toBe("light");
  });
});
