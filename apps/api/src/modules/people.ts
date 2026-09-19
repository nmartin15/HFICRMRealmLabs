import {
  activitySchema,
  canDeletePerson,
  canViewPerson,
  completeTaskBodySchema,
  createPersonBodySchema,
  createPersonNoteBodySchema,
  createPersonResponseSchema,
  createTaskBodySchema,
  currentBoardBadge,
  isPipelineBoardTrack,
  mergePersonTimeline,
  okResponseSchema,
  operatorTasksQuerySchema,
  personBoardBadgeSchema,
  personDetailResponseSchema,
  personIdParamsSchema,
  personListResponseSchema,
  personNoteResponseSchema,
  personPatchSchema,
  personSchema,
  planCompleteTask,
  planCreateTask,
  planDoNotContactChange,
  planLeadTempPatch,
  planUpdateTask,
  operatorTempBodySchema,
  todayIsoInDisplayZone,
  scoreBucketHoldSchema,
  warmthSignalValueSchema,
  taskIdParamsSchema,
  taskSchema,
  updateTaskBodySchema,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  activities,
  allocationCards,
  emailMessages,
  emailThreads,
  incubatorCards,
  listAlternateEmailsByPerson,
  people,
  personCampaignTags,
  personScoreSnapshots,
  personSignals,
  tasks,
  users,
  type Database,
  deleteTasks,
} from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import { createManualContact } from "../lib/contacts.js";
import { ingestExtractedText } from "../lib/signals.js";
import {
  enqueuePersonScore,
  personHasScoreSnapshot,
} from "../lib/score-enqueue.js";
import { writeSuppression } from "../lib/suppression.js";
import {
  emailThreadRowVisible,
  emailThreadsVisibleSql,
  loadMailboxOwners,
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
  serializeEmailThreadWithMessages,
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

async function ingestCallOrMeetingNotes(
  db: Database,
  input: {
    personId: string;
    personEmail: string;
    keyHex: string;
    resumeStorageDir: string;
    kind: string;
    notes: string | null;
    taskId: string;
    actor: { id: string; email: string };
  },
): Promise<void> {
  if ((input.kind !== "call" && input.kind !== "meeting") || !input.notes?.trim()) {
    return;
  }
  await ingestExtractedText(db, {
    personId: input.personId,
    personEmail: input.personEmail,
    keyHex: input.keyHex,
    resumeStorageDir: input.resumeStorageDir,
    text: input.notes,
    sourceType: "task",
    sourceTaskId: input.taskId,
    actor: input.actor,
    occurredAt: new Date(),
  });
}

async function personTimeline(
  db: Database,
  person: { id: string; email: string },
  viewer: { id: string; email: string },
) {
  const owners = await loadMailboxOwners(db);
  const visibility = emailThreadsVisibleSql(viewer, owners) ?? sql`true`;
  const [activityRows, threadRows] = await Promise.all([
    db
      .select()
      .from(activities)
      .where(eq(activities.personId, person.id))
      .orderBy(desc(activities.occurredAt)),
    db
      .select()
      .from(emailThreads)
      .where(and(eq(emailThreads.personId, person.id), visibility))
      .orderBy(desc(emailThreads.lastMessageAt)),
  ]);

  const visibleThreads = threadRows.filter((row) =>
    emailThreadRowVisible(row, viewer, owners),
  );
  const threadIds = visibleThreads.map((row) => row.id);
  const messageRows =
    threadIds.length === 0
      ? []
      : await db
          .select()
          .from(emailMessages)
          .where(inArray(emailMessages.threadId, threadIds))
          .orderBy(asc(emailMessages.sentAt));
  const messagesByThread = new Map<string, typeof messageRows>();
  for (const message of messageRows) {
    const list = messagesByThread.get(message.threadId) ?? [];
    list.push(message);
    messagesByThread.set(message.threadId, list);
  }

  const altMap = await listAlternateEmailsByPerson(db, [person.id]);
  const personEmails = [person.email, ...(altMap.get(person.id) ?? [])];

  return mergePersonTimeline({
    activities: activityRows.map((row) =>
      activitySchema.parse(serializeActivity(row)),
    ),
    threads: visibleThreads.map((row) =>
      serializeEmailThreadWithMessages(
        row,
        messagesByThread.get(row.id) ?? [],
        person.email,
        personEmails,
      ),
    ),
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

  app.post(
    "/people",
    {
      schema: {
        body: createPersonBodySchema,
        response: { 200: createPersonResponseSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      if (!canViewPerson()) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }
      return createPersonResponseSchema.parse(
        await createManualContact(app.db, actor, req.body, app.env.EMAIL_HASH_KEY),
      );
    },
  );

  app.get(
    "/people/:id",
    {
      schema: {
        params: personIdParamsSchema,
        querystring: operatorTasksQuerySchema,
        response: { 200: personDetailResponseSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      if (!canViewPerson()) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }

      const row = await requirePerson(app.db, req.params.id);
      const [board, timeline, taskRows, snapshotRows, campaignHoldRows] = await Promise.all([
        personBoard(app.db, row),
        personTimeline(app.db, row, actor),
        app.db
          .select()
          .from(tasks)
          .where(eq(tasks.personId, row.id))
          .orderBy(asc(tasks.dueAt)),
        app.db
          .select({ hold: personScoreSnapshots.hold })
          .from(personScoreSnapshots)
          .where(eq(personScoreSnapshots.personId, row.id))
          .orderBy(desc(personScoreSnapshots.computedAt))
          .limit(1),
        app.db
          .select({
            tag: personCampaignTags.tag,
            sequenceAction: personCampaignTags.sequenceAction,
          })
          .from(personCampaignTags)
          .where(eq(personCampaignTags.personId, row.id))
          .limit(1),
      ]);

      const hold = snapshotRows[0]
        ? scoreBucketHoldSchema.safeParse(snapshotRows[0].hold)
        : null;
      const campaignHoldRow = campaignHoldRows[0];
      const campaignHold =
        campaignHoldRow?.sequenceAction === "pending_review" &&
        campaignHoldRow.tag
          ? { tag: campaignHoldRow.tag, sequenceAction: "pending_review" as const }
          : null;

      return personDetailResponseSchema.parse({
        person: serializePerson(row),
        board,
        tasks: taskRows.map((task) => serializeTask(task)),
        timeline,
        scoreHoldSummary: hold?.success ? hold.data.summary : null,
        campaignHold,
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
        appliedAt?: string | null;
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
        before.programTrack = row.programTrack;
        after.programTrack = patch.programTrack;
        update.programTrack = patch.programTrack;
        if (patch.programTrack !== null && row.appliedAt === null) {
          const appliedAt = todayIsoInDisplayZone(new Date());
          before.appliedAt = row.appliedAt;
          after.appliedAt = appliedAt;
          update.appliedAt = appliedAt;
        }
      }

      if (patch.leadTemp !== undefined && patch.leadTemp !== row.leadTemp) {
        const owned = planLeadTempPatch(
          await personHasScoreSnapshot(app.db, row.id),
        );
        if (owned.reject) {
          throw httpError(owned.status, owned.code, owned.message);
        }
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
        const dncPlan = planDoNotContactChange({
          currentlyDoNotContact: row.doNotContact,
          nextDoNotContact: patch.doNotContact,
        });
        if (!dncPlan.ok) {
          throw httpError(dncPlan.status, dncPlan.code, dncPlan.message);
        }
        before.doNotContact = row.doNotContact;
        after.doNotContact = patch.doNotContact;
        update.doNotContact = patch.doNotContact;
        if (dncPlan.writeSuppression) {
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

      if (update.doNotContact === true) {
        await writeSuppression(app.db, {
          email: row.email,
          keyHex: app.env.EMAIL_HASH_KEY,
          reason: "do_not_contact",
          source: "operator",
          occurredAt: new Date(),
          createdBy: actor.id,
          actorEmail: actor.email,
          personId: row.id,
        });
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
            stage: "applied",
            routedAt: when,
          });
        }
      }

      if (
        after.budgetQualified !== undefined ||
        after.programTrack !== undefined ||
        after.leadTemp !== undefined
      ) {
        await enqueuePersonScore(app.queues, {
          personId: updated.id,
          trigger: "manual_edit",
          computedBy: actor.id,
        });
      }

      return personSchema.parse(serializePerson(updated));
    },
  );

  app.post(
    "/people/:id/operator-temp",
    {
      schema: {
        params: personIdParamsSchema,
        body: operatorTempBodySchema,
        response: { 200: personSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      const row = await requirePerson(app.db, req.params.id);
      const at = Date.now();
      const value = warmthSignalValueSchema.parse({
        level: req.body.level,
        at,
        setBy: { id: actor.id, email: actor.email, name: actor.name },
      });
      await app.db.insert(personSignals).values({
        personId: row.id,
        kind: "warmth",
        value,
        excerpt: `operator ${req.body.level}`,
        sourceType: "operator",
        extractor: "operator",
      });
      await writeActivity(app.db, {
        personId: row.id,
        userId: actor.id,
        type: "field_change",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "signal.operator_temp",
          when: new Date(at).toISOString(),
          before: null,
          after: { level: req.body.level },
        },
      });
      await enqueuePersonScore(app.queues, {
        personId: row.id,
        trigger: "operator_temp",
        computedBy: actor.id,
      });
      return personSchema.parse(serializePerson(row));
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
        await writeSuppression(app.db, {
          email: row.email,
          keyHex: app.env.EMAIL_HASH_KEY,
          reason: "do_not_contact",
          source: "operator",
          occurredAt: when,
          createdBy: actor.id,
          actorEmail: actor.email,
          personId: row.id,
        });
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
      await ingestCallOrMeetingNotes(app.db, {
        personId: row.id,
        personEmail: row.email,
        keyHex: app.env.EMAIL_HASH_KEY,
        resumeStorageDir: app.env.RESUME_STORAGE_DIR,
        kind: created.kind,
        notes: created.notes,
        taskId: created.id,
        actor,
      });
      return taskSchema.parse(serializeTask(created));
    },
  );

  app.patch(
    "/people/:id/tasks/:taskId",
    {
      schema: {
        params: taskIdParamsSchema,
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
      if (
        req.body.kind === undefined &&
        req.body.dueAt === undefined &&
        req.body.notes === undefined
      ) {
        return taskSchema.parse(serializeTask(current));
      }

      const plan = planUpdateTask({
        currentStatus: current.status,
        currentKind: current.kind,
        currentDueAt: current.dueAt.toISOString(),
        currentNotes: current.notes,
        currentOutcome: current.outcome,
        personDeleted: Boolean(row.deletedAt),
        kind: req.body.kind,
        dueAt: req.body.dueAt,
        notes: req.body.notes,
      });
      if (!plan.ok) {
        throw httpError(plan.status, plan.code, plan.message);
      }
      if (!plan.changed) {
        return taskSchema.parse(serializeTask(current));
      }

      const [updated] = await app.db
        .update(tasks)
        .set({
          kind: plan.kind,
          dueAt: new Date(plan.dueAt),
          notes: plan.notes,
          outcome: plan.outcome,
        })
        .where(eq(tasks.id, current.id))
        .returning();
      if (!updated) {
        throw httpError(500, "INTERNAL", "Failed to update task");
      }

      if (plan.setDoNotContact && !row.doNotContact) {
        await writeSuppression(app.db, {
          email: row.email,
          keyHex: app.env.EMAIL_HASH_KEY,
          reason: "do_not_contact",
          source: "operator",
          occurredAt: new Date(),
          createdBy: actor.id,
          actorEmail: actor.email,
          personId: row.id,
        });
      }

      await writeActivity(app.db, {
        personId: row.id,
        userId: actor.id,
        type: "field_change",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "task.update",
          when: new Date().toISOString(),
          before: {
            taskId: current.id,
            kind: current.kind,
            dueAt: current.dueAt.toISOString(),
            notes: current.notes,
          },
          after: {
            taskId: updated.id,
            kind: updated.kind,
            dueAt: updated.dueAt.toISOString(),
            notes: updated.notes,
          },
        },
      });
      await ingestCallOrMeetingNotes(app.db, {
        personId: row.id,
        personEmail: row.email,
        keyHex: app.env.EMAIL_HASH_KEY,
        resumeStorageDir: app.env.RESUME_STORAGE_DIR,
        kind: updated.kind,
        notes: updated.notes,
        taskId: updated.id,
        actor,
      });
      return taskSchema.parse(serializeTask(updated));
    },
  );

  app.post(
    "/people/:id/tasks/:taskId/complete",
    {
      schema: {
        params: taskIdParamsSchema,
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
      const siblingOpen = await app.db
        .select({
          id: tasks.id,
          kind: tasks.kind,
          dueAt: tasks.dueAt,
          calendarEventId: tasks.calendarEventId,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.personId, row.id),
            eq(tasks.status, "open"),
            ne(tasks.id, current.id),
          ),
        );
      const plan = planCompleteTask({
        currentId: current.id,
        currentKind: current.kind,
        currentStatus: current.status,
        currentDueAt: current.dueAt.toISOString(),
        currentCalendarEventId: current.calendarEventId,
        notes: req.body.notes ?? current.notes,
        outcome: req.body.outcome,
        next: req.body.next,
        personDoNotContact: row.doNotContact,
        personDeleted: Boolean(row.deletedAt),
        otherOpenTasks: siblingOpen.map((task) => ({
          id: task.id,
          kind: task.kind,
          dueAt: task.dueAt.toISOString(),
          calendarEventId: task.calendarEventId,
        })),
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
      if (plan.closeDuplicateIds.length > 0) {
        await app.db
          .update(tasks)
          .set({
            status: plan.status,
            outcome: plan.outcome,
            needsReview: false,
          })
          .where(
            and(
              eq(tasks.personId, row.id),
              eq(tasks.status, "open"),
              inArray(tasks.id, plan.closeDuplicateIds),
            ),
          );
        await writeActivity(app.db, {
          personId: row.id,
          userId: actor.id,
          type: "note",
          payload: {
            who: { id: actor.id, email: actor.email },
            what: "task.complete",
            when: new Date().toISOString(),
            before: { duplicateTaskIds: plan.closeDuplicateIds },
            after: {
              taskIds: plan.closeDuplicateIds,
              status: plan.status,
              outcome: plan.outcome,
              reason: "same_day_meeting",
            },
          },
        });
      }
      if (plan.supersedeLeftoverIds.length > 0) {
        await app.db
          .update(tasks)
          .set({
            status: "rescheduled",
            outcome: "rescheduled",
            needsReview: false,
          })
          .where(
            and(
              eq(tasks.personId, row.id),
              eq(tasks.status, "open"),
              inArray(tasks.id, plan.supersedeLeftoverIds),
            ),
          );
        await writeActivity(app.db, {
          personId: row.id,
          userId: actor.id,
          type: "note",
          payload: {
            who: { id: actor.id, email: actor.email },
            what: "task.complete",
            when: new Date().toISOString(),
            before: { duplicateTaskIds: plan.supersedeLeftoverIds },
            after: {
              taskIds: plan.supersedeLeftoverIds,
              status: "rescheduled",
              outcome: "rescheduled",
              reason: "superseded_leftover",
            },
          },
        });
      }

      const nextStatus = plan.next
        ? plan.next.kind === "dnc"
          ? "done"
          : "open"
        : null;
      if (plan.next) {
        const [createdNext] = await app.db
          .insert(tasks)
          .values({
            personId: row.id,
            kind: plan.next.kind,
            dueAt: new Date(plan.next.dueAt),
            notes: plan.next.notes,
            status: nextStatus ?? "open",
            outcome: plan.next.kind === "meeting" ? "scheduled" : null,
            createdBy: actor.id,
          })
          .returning();
        if (!createdNext) {
          throw httpError(500, "INTERNAL", "Failed to create follow-up task");
        }
        await writeActivity(app.db, {
          personId: row.id,
          userId: actor.id,
          type: "note",
          payload: {
            who: { id: actor.id, email: actor.email },
            what: "task.create",
            when: new Date().toISOString(),
            before: null,
            after: {
              taskId: createdNext.id,
              kind: createdNext.kind,
              notes: createdNext.notes,
              dueAt: createdNext.dueAt.toISOString(),
              followUpFromTaskId: current.id,
            },
          },
        });
      }
      if (plan.setDoNotContact && !row.doNotContact) {
        await writeSuppression(app.db, {
          email: row.email,
          keyHex: app.env.EMAIL_HASH_KEY,
          reason: "do_not_contact",
          source: "operator",
          occurredAt: new Date(),
          createdBy: actor.id,
          actorEmail: actor.email,
          personId: row.id,
        });
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
          after: {
            taskId: current.id,
            kind: current.kind,
            status: plan.status,
            notes: plan.notes,
            outcome: plan.outcome,
            next: plan.next
              ? {
                  kind: plan.next.kind,
                  dueAt: plan.next.dueAt,
                  status: nextStatus,
                }
              : null,
          },
        },
      });
      await ingestCallOrMeetingNotes(app.db, {
        personId: row.id,
        personEmail: row.email,
        keyHex: app.env.EMAIL_HASH_KEY,
        resumeStorageDir: app.env.RESUME_STORAGE_DIR,
        kind: current.kind,
        notes: plan.notes,
        taskId: updated.id,
        actor,
      });
      if (current.kind === "call") {
        await enqueuePersonScore(app.queues, {
          personId: row.id,
          trigger: "call_held",
          computedBy: actor.id,
        });
      } else if (current.kind === "meeting") {
        await enqueuePersonScore(app.queues, {
          personId: row.id,
          trigger: "meeting_held",
          computedBy: actor.id,
        });
      }
      return taskSchema.parse(serializeTask(updated));
    },
  );

  app.delete(
    "/people/:id/tasks/:taskId",
    {
      schema: {
        params: taskIdParamsSchema,
        response: { 200: okResponseSchema },
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

      await deleteTasks(app.db, [current.id]);
      const when = new Date();
      await writeActivity(app.db, {
        personId: row.id,
        userId: actor.id,
        type: "note",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "task.delete",
          when: when.toISOString(),
          before: {
            taskId: current.id,
            kind: current.kind,
            status: current.status,
            dueAt: current.dueAt.toISOString(),
            notes: current.notes,
          },
          after: null,
        },
      });
      return { ok: true as const };
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
      if (row.doNotContact) {
        await writeSuppression(app.db, {
          email: row.email,
          keyHex: app.env.EMAIL_HASH_KEY,
          reason: "do_not_contact",
          source: "operator",
          occurredAt: deletedAt,
          createdBy: actor.id,
          actorEmail: actor.email,
          personId: row.id,
        });
      }
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
