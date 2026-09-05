import {
  activitySchema,
  canDeletePerson,
  canViewPerson,
  completeTaskBodySchema,
  createPersonNoteBodySchema,
  createTaskBodySchema,
  currentBoardBadge,
  isPipelineBoardTrack,
  mergePersonTimeline,
  okResponseSchema,
  personBoardBadgeSchema,
  personDetailResponseSchema,
  personIdParamsSchema,
  personListResponseSchema,
  personNoteResponseSchema,
  personPatchSchema,
  personSchema,
  planCompleteTask,
  planCreateTask,
  planUpdateTaskNotes,
  taskSchema,
  updateTaskBodySchema,
  uuidSchema,
} from "@realm-labs/contracts";
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  activities,
  allocationCards,
  emailThreads,
  incubatorCards,
  people,
  tasks,
  users,
  type Database,
} from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import {
  emailThreadRowVisible,
  emailThreadsVisibleSql,
  loadPersonalMailboxOwner,
} from "../lib/email-visibility.js";
import {
  isAllowedResume,
  isStoredResumeUrl,
  readResumeFile,
  saveResumeFile,
  storedResumePath,
} from "../lib/resume.js";
import {
  serializeActivity,
  serializeEmailThread,
  serializePerson,
  serializeTask,
} from "../lib/serialize.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

async function requirePerson(db: Database, id: string) {
  const existing = await db
    .select()
    .from(people)
    .where(and(eq(people.id, id), isNull(people.deletedAt)))
    .limit(1);
  const row = existing[0];
  if (!row) {
    throw httpError(404, "NOT_FOUND", "Person not found");
  }
  return row;
}

async function personTimeline(
  db: Database,
  personId: string,
  viewer: { id: string; email: string },
) {
  const owner = await loadPersonalMailboxOwner(db);
  const visibility = emailThreadsVisibleSql(viewer, owner) ?? sql`true`;
  const [activityRows, threadRows] = await Promise.all([
    db
      .select()
      .from(activities)
      .where(eq(activities.personId, personId))
      .orderBy(desc(activities.occurredAt)),
    db
      .select()
      .from(emailThreads)
      .where(and(eq(emailThreads.personId, personId), visibility))
      .orderBy(desc(emailThreads.lastMessageAt)),
  ]);

  const visibleThreads = threadRows.filter((row) =>
    emailThreadRowVisible(row, viewer, owner),
  );

  return mergePersonTimeline({
    activities: activityRows.map((row) =>
      activitySchema.parse(serializeActivity(row)),
    ),
    threads: visibleThreads.map((row) => serializeEmailThread(row)),
  });
}

async function personBoard(
  db: Database,
  person: typeof people.$inferSelect,
) {
  const [allocRows, incubRows] = await Promise.all([
    db
      .select()
      .from(allocationCards)
      .where(eq(allocationCards.personId, person.id))
      .limit(1),
    db
      .select()
      .from(incubatorCards)
      .where(eq(incubatorCards.personId, person.id))
      .limit(1),
  ]);

  const badge = currentBoardBadge({
    programTrack: person.programTrack,
    doNotContact: person.doNotContact,
    allocationStage: allocRows[0]?.stage ?? null,
    incubatorStage: incubRows[0]?.stage ?? null,
  });
  return badge ? personBoardBadgeSchema.parse(badge) : null;
}

export const peopleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/people",
    {
      schema: {
        response: { 200: personListResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      if (!canViewPerson()) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }

      const rows = await app.db
        .select()
        .from(people)
        .where(and(isNull(people.deletedAt), eq(people.doNotContact, false)))
        // DNC people are omitted from lists and exports; the record page still loads.
        .orderBy(asc(people.lastName), asc(people.firstName));

      return {
        data: rows.map((row) => personSchema.parse(serializePerson(row))),
      };
    },
  );

  app.get(
    "/people/:id",
    {
      schema: {
        params: personIdParamsSchema,
        response: { 200: personDetailResponseSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      if (!canViewPerson()) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }

      const row = await requirePerson(app.db, req.params.id);
      const [board, timeline, taskRows] = await Promise.all([
        personBoard(app.db, row),
        personTimeline(app.db, row.id, actor),
        app.db
          .select()
          .from(tasks)
          .where(eq(tasks.personId, row.id))
          .orderBy(asc(tasks.dueAt)),
      ]);

      return personDetailResponseSchema.parse({
        person: serializePerson(row),
        board,
        tasks: taskRows.map((task) => serializeTask(task)),
        timeline,
      });
    },
  );

  app.patch(
    "/people/:id",
    {
      schema: {
        params: personIdParamsSchema,
        body: personPatchSchema,
        response: { 200: personSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      const row = await requirePerson(app.db, req.params.id);
      const patch = req.body;

      if (patch.ownerId) {
        const owner = await app.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, patch.ownerId))
          .limit(1);
        if (!owner[0]) {
          throw httpError(400, "INVALID_OWNER", "Owner not found");
        }
      }

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const update: {
        firstName?: string;
        lastName?: string;
        leadTemp?: typeof row.leadTemp;
        budgetQualified?: typeof row.budgetQualified;
        programTrack?: typeof row.programTrack;
        doNotContact?: boolean;
        needsReview?: boolean;
        notes?: string | null;
        resumeFilename?: string | null;
        resumeContentType?: string | null;
        ownerId?: string | null;
      } = {};

      if (
        patch.firstName !== undefined &&
        patch.firstName !== row.firstName
      ) {
        before.firstName = row.firstName;
        after.firstName = patch.firstName;
        update.firstName = patch.firstName;
      }
      if (
        patch.lastName !== undefined &&
        patch.lastName !== row.lastName
      ) {
        before.lastName = row.lastName;
        after.lastName = patch.lastName;
        update.lastName = patch.lastName;
      }

      if (
        patch.programTrack !== undefined &&
        patch.programTrack !== row.programTrack
      ) {
        if (
          patch.programTrack === null &&
          !row.doNotContact &&
          (patch.doNotContact !== true)
        ) {
          throw httpError(
            400,
            "PROGRAM_TRACK_REQUIRED",
            "Program track is required unless DNC",
          );
        }
        before.programTrack = row.programTrack;
        after.programTrack = patch.programTrack;
        update.programTrack = patch.programTrack;
      }

      if (patch.leadTemp !== undefined && patch.leadTemp !== row.leadTemp) {
        before.leadTemp = row.leadTemp;
        after.leadTemp = patch.leadTemp;
        update.leadTemp = patch.leadTemp;
      }
      if (
        patch.budgetQualified !== undefined &&
        patch.budgetQualified !== row.budgetQualified
      ) {
        before.budgetQualified = row.budgetQualified;
        after.budgetQualified = patch.budgetQualified;
        update.budgetQualified = patch.budgetQualified;
      }
      if (
        patch.doNotContact !== undefined &&
        patch.doNotContact !== row.doNotContact
      ) {
        before.doNotContact = row.doNotContact;
        after.doNotContact = patch.doNotContact;
        update.doNotContact = patch.doNotContact;
        if (patch.doNotContact) {
          before.programTrack = row.programTrack;
          after.programTrack = null;
          update.programTrack = null;
        }
      }
      if (
        patch.needsReview !== undefined &&
        patch.needsReview !== row.needsReview
      ) {
        before.needsReview = row.needsReview;
        after.needsReview = patch.needsReview;
        update.needsReview = patch.needsReview;
      }
      if (patch.notes !== undefined && patch.notes !== row.notes) {
        before.notes = row.notes;
        after.notes = patch.notes;
        update.notes = patch.notes;
      }
      if (
        patch.resumeFilename !== undefined &&
        patch.resumeFilename !== row.resumeFilename
      ) {
        before.resumeFilename = row.resumeFilename;
        after.resumeFilename = patch.resumeFilename;
        update.resumeFilename = patch.resumeFilename;
      }
      if (
        patch.resumeContentType !== undefined &&
        patch.resumeContentType !== row.resumeContentType
      ) {
        before.resumeContentType = row.resumeContentType;
        after.resumeContentType = patch.resumeContentType;
        update.resumeContentType = patch.resumeContentType;
      }
      if (patch.ownerId !== undefined && patch.ownerId !== row.ownerId) {
        before.ownerId = row.ownerId;
        after.ownerId = patch.ownerId;
        update.ownerId = patch.ownerId;
      }

      if (Object.keys(update).length === 0) {
        return personSchema.parse(serializePerson(row));
      }

      const [updated] = await app.db
        .update(people)
        .set(update)
        .where(eq(people.id, row.id))
        .returning();
      if (!updated) {
        throw httpError(404, "NOT_FOUND", "Person not found");
      }

      const when = new Date();
      await writeActivity(app.db, {
        personId: row.id,
        userId: actor.id,
        type: "field_change",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "person.update",
          when: when.toISOString(),
          before,
          after,
        },
      });

      if (isPipelineBoardTrack(updated.programTrack)) {
        const existingAlloc = await app.db
          .select({ id: allocationCards.id })
          .from(allocationCards)
          .where(eq(allocationCards.personId, updated.id))
          .limit(1);
        if (!existingAlloc[0]) {
          await app.db.insert(allocationCards).values({
            personId: updated.id,
            stage: "applied",
          });
        }
      }
      if (updated.programTrack === "incubator") {
        const existingIncub = await app.db
          .select({ id: incubatorCards.id })
          .from(incubatorCards)
          .where(eq(incubatorCards.personId, updated.id))
          .limit(1);
        if (!existingIncub[0]) {
          await app.db.insert(incubatorCards).values({
            personId: updated.id,
            stage: "sent",
            routedAt: when,
          });
        }
      }

      return personSchema.parse(serializePerson(updated));
    },
  );

  app.post(
    "/people/:id/resume",
    {
      schema: {
        params: personIdParamsSchema,
        response: { 200: personSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      const row = await requirePerson(app.db, req.params.id);
      const file = await req.file();
      if (!file) {
        throw httpError(400, "FILE_REQUIRED", "Resume file is required");
      }
      const filename = file.filename || "resume.pdf";
      const contentType = file.mimetype || "application/octet-stream";
      if (!isAllowedResume({ filename, contentType })) {
        throw httpError(400, "INVALID_RESUME", "Attach a PDF or Word document");
      }
      const bytes = await file.toBuffer();
      await saveResumeFile({
        storageDir: req.server.env.RESUME_STORAGE_DIR,
        personId: row.id,
        filename,
        contentType,
        bytes,
      });
      const resumeUrl = storedResumePath(row.id);
      const [updated] = await app.db
        .update(people)
        .set({
          resumeFilename: filename,
          resumeContentType: contentType,
          resumeUrl,
        })
        .where(eq(people.id, row.id))
        .returning();
      if (!updated) {
        throw httpError(404, "NOT_FOUND", "Person not found");
      }
      const when = new Date();
      await writeActivity(app.db, {
        personId: row.id,
        userId: actor.id,
        type: "field_change",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "person.resume",
          when: when.toISOString(),
          before: {
            resumeFilename: row.resumeFilename,
            resumeUrl: row.resumeUrl,
          },
          after: {
            resumeFilename: filename,
            resumeUrl,
          },
        },
      });
      return personSchema.parse(serializePerson(updated));
    },
  );

  app.get(
    "/people/:id/resume",
    {
      schema: {
        params: personIdParamsSchema,
      },
    },
    async (req, reply) => {
      requireUser(req);
      const row = await requirePerson(app.db, req.params.id);
      if (!isStoredResumeUrl(row.resumeUrl)) {
        throw httpError(404, "NOT_FOUND", "No uploaded resume");
      }
      const stored = await readResumeFile({
        storageDir: req.server.env.RESUME_STORAGE_DIR,
        personId: row.id,
      });
      if (!stored) {
        throw httpError(404, "NOT_FOUND", "No uploaded resume");
      }
      const downloadName = row.resumeFilename ?? stored.filename;
      return reply
        .header(
          "Content-Type",
          row.resumeContentType ?? "application/octet-stream",
        )
        .header(
          "Content-Disposition",
          `inline; filename="${downloadName.replaceAll('"', "")}"`,
        )
        .send(stored.bytes);
    },
  );

  app.post(
    "/people/:id/notes",
    {
      schema: {
        params: personIdParamsSchema,
        body: createPersonNoteBodySchema,
        response: { 200: personNoteResponseSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      const row = await requirePerson(app.db, req.params.id);
      const when = new Date();
      const note = await writeActivity(app.db, {
        personId: row.id,
        userId: actor.id,
        type: "note",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "note",
          when: when.toISOString(),
          before: null,
          after: { text: req.body.text },
        },
      });

      return personNoteResponseSchema.parse(serializeActivity(note));
    },
  );

  app.post(
    "/people/:id/tasks",
    {
      schema: {
        params: personIdParamsSchema,
        body: createTaskBodySchema,
        response: { 200: taskSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      const row = await requirePerson(app.db, req.params.id);
      const plan = planCreateTask({
        kind: req.body.kind,
        notes: req.body.notes,
        personDoNotContact: row.doNotContact,
        personDeleted: Boolean(row.deletedAt),
      });
      if (!plan.ok) {
        throw httpError(plan.status, plan.code, plan.message);
      }

      const [created] = await app.db
        .insert(tasks)
        .values({
          personId: row.id,
          kind: plan.kind,
          dueAt: new Date(req.body.dueAt),
          notes: plan.notes,
          status: plan.kind === "dnc" ? "done" : "open",
          outcome: plan.kind === "meeting" ? "scheduled" : null,
          createdBy: actor.id,
        })
        .returning();
      if (!created) {
        throw httpError(500, "INTERNAL", "Failed to create task");
      }

      const when = new Date();
      if (plan.setDoNotContact && !row.doNotContact) {
        await app.db
          .update(people)
          .set({ doNotContact: true, programTrack: null })
          .where(eq(people.id, row.id));
      }
      await writeActivity(app.db, {
        personId: row.id,
        userId: actor.id,
        type: "note",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "task.create",
          when: when.toISOString(),
          before: null,
          after: {
            kind: created.kind,
            notes: created.notes,
            dueAt: created.dueAt.toISOString(),
          },
        },
      });
      return taskSchema.parse(serializeTask(created));
    },
  );

  app.patch(
    "/people/:id/tasks/:taskId",
    {
      schema: {
        params: z.object({ id: uuidSchema, taskId: uuidSchema }),
        body: updateTaskBodySchema,
        response: { 200: taskSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      const row = await requirePerson(app.db, req.params.id);
      const [current] = await app.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, req.params.taskId), eq(tasks.personId, row.id)))
        .limit(1);
      if (!current) {
        throw httpError(404, "NOT_FOUND", "Task not found");
      }
      if (req.body.notes === undefined) {
        return taskSchema.parse(serializeTask(current));
      }

      const plan = planUpdateTaskNotes({
        currentStatus: current.status,
        currentKind: current.kind,
        notes: req.body.notes,
      });
      if (!plan.ok) {
        throw httpError(plan.status, plan.code, plan.message);
      }

      const [updated] = await app.db
        .update(tasks)
        .set({ notes: plan.notes })
        .where(eq(tasks.id, current.id))
        .returning();
      if (!updated) {
        throw httpError(500, "INTERNAL", "Failed to update task");
      }

      await writeActivity(app.db, {
        personId: row.id,
        userId: actor.id,
        type: "note",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "task.notes",
          when: new Date().toISOString(),
          before: { notes: current.notes },
          after: { notes: updated.notes },
        },
      });
      return taskSchema.parse(serializeTask(updated));
    },
  );

  app.post(
    "/people/:id/tasks/:taskId/complete",
    {
      schema: {
        params: z.object({ id: uuidSchema, taskId: uuidSchema }),
        body: completeTaskBodySchema,
        response: { 200: taskSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      const row = await requirePerson(app.db, req.params.id);
      const existing = await app.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, req.params.taskId), eq(tasks.personId, row.id)))
        .limit(1);
      const current = existing[0];
      if (!current) {
        throw httpError(404, "NOT_FOUND", "Task not found");
      }
      const plan = planCompleteTask({
        currentKind: current.kind,
        currentStatus: current.status,
        notes: req.body.notes ?? current.notes,
        outcome: req.body.outcome,
        next: req.body.next,
        personDoNotContact: row.doNotContact,
        personDeleted: Boolean(row.deletedAt),
      });
      if (!plan.ok) {
        throw httpError(plan.status, plan.code, plan.message);
      }

      const [updated] = await app.db
        .update(tasks)
        .set({
          status: plan.status,
          notes: plan.notes,
          outcome: plan.outcome,
          needsReview: false,
        })
        .where(eq(tasks.id, current.id))
        .returning();
      if (!updated) {
        throw httpError(500, "INTERNAL", "Failed to complete task");
      }

      if (plan.next) {
        await app.db.insert(tasks).values({
          personId: row.id,
          kind: plan.next.kind,
          dueAt: new Date(plan.next.dueAt),
          notes: plan.next.notes,
          status: plan.next.kind === "dnc" ? "done" : "open",
          outcome: plan.next.kind === "meeting" ? "scheduled" : null,
          createdBy: actor.id,
        });
      }
      if (plan.setDoNotContact && !row.doNotContact) {
        await app.db
          .update(people)
          .set({ doNotContact: true, programTrack: null })
          .where(eq(people.id, row.id));
      }

      const when = new Date();
      await writeActivity(app.db, {
        personId: row.id,
        userId: actor.id,
        type: "note",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "task.complete",
          when: when.toISOString(),
          before: { status: current.status },
          after: { status: plan.status, notes: plan.notes, outcome: plan.outcome },
        },
      });
      return taskSchema.parse(serializeTask(updated));
    },
  );

  app.delete(
    "/people/:id",
    {
      schema: {
        params: personIdParamsSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      if (!canDeletePerson(actor.role)) {
        throw httpError(403, "FORBIDDEN", "Only admin can delete people");
      }

      const row = await requirePerson(app.db, req.params.id);
      const deletedAt = new Date();
      await app.db
        .update(people)
        .set({ deletedAt })
        .where(eq(people.id, row.id));

      await writeActivity(app.db, {
        personId: row.id,
        userId: actor.id,
        type: "field_change",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "person.delete",
          when: deletedAt.toISOString(),
          before: { deletedAt: null },
          after: { deletedAt: deletedAt.toISOString() },
        },
      });

      return { ok: true as const };
    },
  );
};
