import {
  assignImportActions,
  canViewPerson,
  fillBlankPersonFields,
  hasIncubatorImportSignal,
  importCommitResponseSchema,
  importFileBodySchema,
  importPreviewResponseSchema,
  importSourceFilename,
  mapImportRecords,
  parseImportFile,
  personFieldsChanged,
  planImportAllocation,
  planImportIncubator,
  previewImportCounts,
  type ImportExistingPerson,
  type ImportMappedRow,
  type ImportPersonFields,
  type ImportPreviewRow,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { eq, inArray } from "drizzle-orm";
import {
  allocationCards,
  incubatorCards,
  people,
  tasks,
  type Database,
} from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import type { AuthedUser } from "../plugins/auth.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

const BODY_LIMIT = 5_000_000;

type PersonRow = typeof people.$inferSelect;
type AllocationRow = typeof allocationCards.$inferSelect;
type IncubatorRow = typeof incubatorCards.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

function toPersonFields(row: PersonRow): ImportPersonFields {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    title: row.title,
    company: row.company,
    location: row.location,
    source: row.source,
    resumeUrl: row.resumeUrl,
    appliedAt: row.appliedAt,
    notes: row.notes,
    leadTemp: row.leadTemp,
    budgetQualified: row.budgetQualified,
  };
}

function toIncubatorExisting(row: IncubatorRow) {
  return {
    stage: row.stage,
    routedAt: row.routedAt.toISOString(),
    applicationRef: row.applicationRef,
    applicationResult: row.applicationResult,
    routingDetail: row.routingDetail,
    closeReason: row.closeReason,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}

function parseOrThrow(filename: string, content: string) {
  const parsed = parseImportFile(filename, content);
  if (!parsed.ok) {
    throw httpError(400, "INVALID_SPREADSHEET", parsed.message);
  }
  return mapImportRecords(parsed.records);
}

async function loadExistingByEmail(db: Database, emails: string[]) {
  if (emails.length === 0) {
    return {
      people: [] as PersonRow[],
      allocationByPerson: new Map<string, AllocationRow>(),
      incubatorByPerson: new Map<string, IncubatorRow>(),
      tasksByPerson: new Map<string, TaskRow[]>(),
    };
  }

  const personRows = await db
    .select()
    .from(people)
    .where(inArray(people.email, emails));
  const ids = personRows.map((row) => row.id);
  if (ids.length === 0) {
    return {
      people: personRows,
      allocationByPerson: new Map<string, AllocationRow>(),
      incubatorByPerson: new Map<string, IncubatorRow>(),
      tasksByPerson: new Map<string, TaskRow[]>(),
    };
  }

  const [allocRows, incubRows, taskRows] = await Promise.all([
    db
      .select()
      .from(allocationCards)
      .where(inArray(allocationCards.personId, ids)),
    db
      .select()
      .from(incubatorCards)
      .where(inArray(incubatorCards.personId, ids)),
    db.select().from(tasks).where(inArray(tasks.personId, ids)),
  ]);

  const allocationByPerson = new Map(
    allocRows.map((row) => [row.personId, row] as const),
  );
  const incubatorByPerson = new Map(
    incubRows.map((row) => [row.personId, row] as const),
  );
  const tasksByPerson = new Map<string, TaskRow[]>();
  for (const row of taskRows) {
    const list = tasksByPerson.get(row.personId) ?? [];
    list.push(row);
    tasksByPerson.set(row.personId, list);
  }

  return {
    people: personRows,
    allocationByPerson,
    incubatorByPerson,
    tasksByPerson,
  };
}

function previewPeople(rows: PersonRow[]): ImportExistingPerson[] {
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  }));
}

function uniqueEmails(rows: ImportMappedRow[]): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const row of rows) {
    const email = row.person?.email;
    if (!email || seen.has(email)) {
      continue;
    }
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

async function commitRow(
  db: Database,
  input: {
    mapped: ImportMappedRow;
    action: "create" | "update";
    actor: AuthedUser;
    filename: string;
    now: Date;
    existingPerson: PersonRow | null;
    existingAllocation: AllocationRow | null;
    existingIncubator: IncubatorRow | null;
    existingTasks: TaskRow[];
  },
): Promise<void> {
  const incoming = input.mapped.person;
  if (!incoming) {
    return;
  }

  const actor = input.actor;
  const now = input.now;
  const nowIso = now.toISOString();
  const who = { id: actor.id, email: actor.email };
  const incubatorSignal = hasIncubatorImportSignal(input.mapped.incubator);
  const allocationPlan = planImportAllocation({
    existingStage: input.existingAllocation?.stage ?? null,
    existingDecision: input.existingAllocation?.decision ?? null,
    existingPassReason: input.existingAllocation?.passReason ?? null,
    existingDoNotContact: input.existingPerson?.doNotContact ?? false,
    contacted: input.mapped.contacted,
    hasMeeting: input.mapped.tasks.length > 0,
    incubator: incubatorSignal,
    passed: input.mapped.passed,
    rejection: input.mapped.rejection,
    rejectionReason: input.mapped.rejectionReason,
  });

  const previousStage = input.existingAllocation?.stage ?? "applied";
  const previousDecision = input.existingAllocation?.decision ?? null;
  const previousDoNotContact = input.existingPerson?.doNotContact ?? false;

  let personId: string;
  let personBefore: ImportPersonFields | null = null;
  let personAfter: ImportPersonFields = incoming;

  if (input.action === "create") {
    const [created] = await db
      .insert(people)
      .values({
        firstName: incoming.firstName,
        lastName: incoming.lastName,
        email: incoming.email,
        title: incoming.title,
        company: incoming.company,
        location: incoming.location,
        source: incoming.source,
        resumeUrl: incoming.resumeUrl,
        appliedAt: incoming.appliedAt,
        notes: incoming.notes,
        leadTemp: incoming.leadTemp,
        budgetQualified: incoming.budgetQualified,
        doNotContact: allocationPlan.doNotContact,
      })
      .returning();
    if (!created) {
      throw httpError(500, "INTERNAL", "Failed to create person");
    }
    personId = created.id;
  } else {
    const existing = input.existingPerson;
    if (!existing) {
      throw httpError(500, "INTERNAL", "Update row missing existing person");
    }
    personId = existing.id;
    personBefore = toPersonFields(existing);
    personAfter = fillBlankPersonFields(personBefore, incoming);
    const fieldsChanged = personFieldsChanged(personBefore, personAfter);
    const dncChanged = previousDoNotContact !== allocationPlan.doNotContact;
    if (fieldsChanged || dncChanged) {
      await db
        .update(people)
        .set({
          title: personAfter.title,
          company: personAfter.company,
          location: personAfter.location,
          resumeUrl: personAfter.resumeUrl,
          appliedAt: personAfter.appliedAt,
          notes: personAfter.notes,
          leadTemp: personAfter.leadTemp,
          budgetQualified: personAfter.budgetQualified,
          doNotContact: allocationPlan.doNotContact,
        })
        .where(eq(people.id, personId));
    }
  }

  const decisionChanged = previousDecision !== allocationPlan.decision;
  const decidedAt =
    allocationPlan.decision && (decisionChanged || !input.existingAllocation)
      ? now
      : (input.existingAllocation?.decidedAt ?? null);
  const decidedBy =
    allocationPlan.decision && (decisionChanged || !input.existingAllocation)
      ? actor.id
      : (input.existingAllocation?.decidedBy ?? null);

  if (!input.existingAllocation) {
    await db.insert(allocationCards).values({
      personId,
      stage: allocationPlan.stage,
      decision: allocationPlan.decision,
      decidedAt,
      decidedBy,
      passReason: allocationPlan.passReason,
    });
  } else if (
    input.existingAllocation.stage !== allocationPlan.stage ||
    input.existingAllocation.decision !== allocationPlan.decision ||
    input.existingAllocation.passReason !== allocationPlan.passReason
  ) {
    await db
      .update(allocationCards)
      .set({
        stage: allocationPlan.stage,
        decision: allocationPlan.decision,
        decidedAt,
        decidedBy,
        passReason: allocationPlan.passReason,
        nurtureFollowUpAt:
          allocationPlan.decision === "allocate" ||
          allocationPlan.decision === "pass"
            ? null
            : input.existingAllocation.nurtureFollowUpAt,
      })
      .where(eq(allocationCards.id, input.existingAllocation.id));
  }

  const incubatorPlan = planImportIncubator(
    input.existingIncubator
      ? toIncubatorExisting(input.existingIncubator)
      : null,
    input.mapped.incubator,
    nowIso,
  );

  if (incubatorPlan && !input.existingIncubator) {
    await db.insert(incubatorCards).values({
      personId,
      stage: incubatorPlan.stage,
      applicationRef: incubatorPlan.applicationRef,
      applicationResult: incubatorPlan.applicationResult,
      routingDetail: incubatorPlan.routingDetail,
      routedAt: new Date(incubatorPlan.routedAt),
      closeReason: incubatorPlan.closeReason,
      closedAt: incubatorPlan.closedAt
        ? new Date(incubatorPlan.closedAt)
        : null,
    });
  } else if (incubatorPlan && input.existingIncubator) {
    const existing = input.existingIncubator;
    if (
      existing.stage !== incubatorPlan.stage ||
      existing.applicationRef !== incubatorPlan.applicationRef ||
      existing.applicationResult !== incubatorPlan.applicationResult ||
      existing.routingDetail !== incubatorPlan.routingDetail ||
      existing.closeReason !== incubatorPlan.closeReason ||
      (existing.closedAt ? existing.closedAt.toISOString() : null) !==
        incubatorPlan.closedAt
    ) {
      await db
        .update(incubatorCards)
        .set({
          stage: incubatorPlan.stage,
          applicationRef: incubatorPlan.applicationRef,
          applicationResult: incubatorPlan.applicationResult,
          routingDetail: incubatorPlan.routingDetail,
          closeReason: incubatorPlan.closeReason,
          closedAt: incubatorPlan.closedAt
            ? new Date(incubatorPlan.closedAt)
            : null,
        })
        .where(eq(incubatorCards.id, existing.id));
    }
  }

  const existingTaskKeys = new Set(
    input.existingTasks.map((row) => `${row.kind}:${row.dueAt.toISOString()}`),
  );
  const createdTasks: string[] = [];
  for (const task of input.mapped.tasks) {
    const key = `${task.kind}:${task.dueAt}`;
    if (existingTaskKeys.has(key)) {
      continue;
    }
    existingTaskKeys.add(key);
    await db.insert(tasks).values({
      personId,
      kind: task.kind,
      dueAt: new Date(task.dueAt),
      notes: task.notes,
      status: task.status,
      outcome: task.kind === "meeting" ? (task.status === "open" ? "scheduled" : "held") : null,
      createdBy: actor.id,
    });
    createdTasks.push(task.dueAt);
  }

  await writeActivity(db, {
    personId,
    userId: actor.id,
    type: "import",
    payload: {
      who,
      what: "import",
      when: nowIso,
      before: null,
      after: { filename: input.filename, action: input.action },
    },
  });

  if (
    input.action === "update" &&
    personBefore &&
    personFieldsChanged(personBefore, personAfter)
  ) {
    await writeActivity(db, {
      personId,
      userId: actor.id,
      type: "field_change",
      payload: {
        who,
        what: "person.update",
        when: nowIso,
        before: {
          title: personBefore.title,
          company: personBefore.company,
          location: personBefore.location,
          resumeUrl: personBefore.resumeUrl,
          appliedAt: personBefore.appliedAt,
          notes: personBefore.notes,
          leadTemp: personBefore.leadTemp,
          budgetQualified: personBefore.budgetQualified,
        },
        after: {
          title: personAfter.title,
          company: personAfter.company,
          location: personAfter.location,
          resumeUrl: personAfter.resumeUrl,
          appliedAt: personAfter.appliedAt,
          notes: personAfter.notes,
          leadTemp: personAfter.leadTemp,
          budgetQualified: personAfter.budgetQualified,
        },
      },
    });
  }

  if (previousDoNotContact !== allocationPlan.doNotContact) {
    await writeActivity(db, {
      personId,
      userId: actor.id,
      type: "field_change",
      payload: {
        who,
        what: "person.update",
        when: nowIso,
        before: { doNotContact: previousDoNotContact },
        after: { doNotContact: allocationPlan.doNotContact },
      },
    });
  }

  if (input.mapped.activity) {
    await writeActivity(db, {
      personId,
      userId: actor.id,
      type: "note",
      payload: {
        who,
        what: "note",
        when: input.mapped.activity.occurredAt,
        before: null,
        after: { text: input.mapped.activity.text },
      },
    });
  }

  const skipNowStageChange =
    Boolean(input.mapped.activity) &&
    allocationPlan.stage === "contacted" &&
    previousStage === "applied";
  if (previousStage !== allocationPlan.stage && !skipNowStageChange) {
    await writeActivity(db, {
      personId,
      userId: actor.id,
      type: "stage_change",
      payload: {
        who,
        what: "allocation.stage_change",
        when: nowIso,
        before: { stage: previousStage },
        after: { stage: allocationPlan.stage },
      },
    });
  }

  if (decisionChanged && allocationPlan.decision) {
    await writeActivity(db, {
      personId,
      userId: actor.id,
      type: "decision",
      payload: {
        who,
        what: "allocation.decide",
        when: nowIso,
        before: { stage: previousStage, decision: previousDecision },
        after: {
          stage: allocationPlan.stage,
          decision: allocationPlan.decision,
          passReason: allocationPlan.passReason,
        },
      },
    });
  }

  if (incubatorPlan) {
    const previousIncubatorStage = input.existingIncubator?.stage ?? null;
    if (previousIncubatorStage !== incubatorPlan.stage) {
      await writeActivity(db, {
        personId,
        userId: actor.id,
        type: "stage_change",
        payload: {
          who,
          what: "incubator.stage_change",
          when: incubatorPlan.routedAt,
          before: { stage: previousIncubatorStage },
          after: { stage: incubatorPlan.stage },
        },
      });
    }
  }

  for (const scheduledAt of createdTasks) {
    await writeActivity(db, {
      personId,
      userId: actor.id,
      type: "note",
      payload: {
        who,
        what: "task.create",
        when: scheduledAt,
        before: null,
        after: { dueAt: scheduledAt },
      },
    });
  }
}

function previewFromMapped(
  mapped: ImportMappedRow[],
  existing: ImportExistingPerson[],
  filename: string,
) {
  const rows: ImportPreviewRow[] = assignImportActions(mapped, existing);
  return importPreviewResponseSchema.parse({
    filename,
    rows,
    counts: previewImportCounts(rows),
  });
}

export const importRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/import/preview",
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        body: importFileBodySchema,
        response: { 200: importPreviewResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      if (!canViewPerson()) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }

      const filename = importSourceFilename(req.body.filename);
      const mapped = parseOrThrow(filename, req.body.content);
      const loaded = await loadExistingByEmail(
        app.db,
        uniqueEmails(mapped),
      );
      return previewFromMapped(mapped, previewPeople(loaded.people), filename);
    },
  );

  app.post(
    "/import/commit",
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        body: importFileBodySchema,
        response: { 200: importCommitResponseSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      if (!canViewPerson()) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }

      const filename = importSourceFilename(req.body.filename);
      const mapped = parseOrThrow(filename, req.body.content);
      const loaded = await loadExistingByEmail(
        app.db,
        uniqueEmails(mapped),
      );
      const preview = assignImportActions(mapped, previewPeople(loaded.people));
      const peopleByEmail = new Map(
        loaded.people.map((row) => [row.email, row] as const),
      );
      const now = new Date();

      await app.db.transaction(async (tx) => {
        const db = tx as unknown as Database;
        for (let i = 0; i < mapped.length; i += 1) {
          const row = mapped[i];
          const action = preview[i]?.action;
          if (!row || (action !== "create" && action !== "update")) {
            continue;
          }
          const email = row.person?.email;
          const existingPerson = email ? (peopleByEmail.get(email) ?? null) : null;
          await commitRow(db, {
            mapped: row,
            action,
            actor,
            filename,
            now,
            existingPerson,
            existingAllocation: existingPerson
              ? (loaded.allocationByPerson.get(existingPerson.id) ?? null)
              : null,
            existingIncubator: existingPerson
              ? (loaded.incubatorByPerson.get(existingPerson.id) ?? null)
              : null,
            existingTasks: existingPerson
              ? (loaded.tasksByPerson.get(existingPerson.id) ?? [])
              : [],
          });
        }
      });

      return importCommitResponseSchema.parse({
        filename,
        created: preview.filter((row) => row.action === "create").length,
        updated: preview.filter((row) => row.action === "update").length,
        skipped: preview.filter((row) => row.action === "skip").length,
      });
    },
  );
};
