import {
  activitySchema,
  canDeletePerson,
  canViewEmailThread,
  canViewPerson,
  createPersonNoteBodySchema,
  currentBoardBadge,
  mergePersonTimeline,
  okResponseSchema,
  personBoardBadgeSchema,
  personDetailResponseSchema,
  personIdParamsSchema,
  personListResponseSchema,
  personNoteResponseSchema,
  personPatchSchema,
  personSchema,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  activities,
  allocationCards,
  emailThreads,
  incubatorCards,
  meetings,
  people,
  users,
  type Database,
} from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import { emailThreadsVisibleSql } from "../lib/email-visibility.js";
import {
  serializeActivity,
  serializeEmailThread,
  serializeMeeting,
  serializePerson,
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
  viewerEmail: string,
) {
  const [activityRows, meetingRows, threadRows] = await Promise.all([
    db
      .select()
      .from(activities)
      .where(eq(activities.personId, personId))
      .orderBy(desc(activities.occurredAt)),
    db
      .select()
      .from(meetings)
      .where(eq(meetings.personId, personId))
      .orderBy(desc(meetings.scheduledAt)),
    db
      .select()
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.personId, personId),
          emailThreadsVisibleSql(viewerEmail) ?? sql`true`,
        ),
      )
      .orderBy(desc(emailThreads.lastMessageAt)),
  ]);

  const visibleThreads = threadRows.filter((row) =>
    canViewEmailThread({
      mailbox: row.mailbox,
      sharedVisible: row.sharedVisible,
      viewerEmail,
    }),
  );

  return mergePersonTimeline({
    activities: activityRows.map((row) =>
      activitySchema.parse(serializeActivity(row)),
    ),
    meetings: meetingRows.map((row) => serializeMeeting(row)),
    threads: visibleThreads.map((row) => serializeEmailThread(row)),
  });
}

async function personBoard(db: Database, personId: string) {
  const [allocRows, incubRows] = await Promise.all([
    db
      .select()
      .from(allocationCards)
      .where(eq(allocationCards.personId, personId))
      .limit(1),
    db
      .select()
      .from(incubatorCards)
      .where(eq(incubatorCards.personId, personId))
      .limit(1),
  ]);

  const badge = currentBoardBadge({
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
      const [board, timeline] = await Promise.all([
        personBoard(app.db, row.id),
        personTimeline(app.db, row.id, actor.email),
      ]);

      return personDetailResponseSchema.parse({
        person: serializePerson(row),
        board,
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
        leadTemp?: typeof row.leadTemp;
        budgetQualified?: typeof row.budgetQualified;
        doNotContact?: boolean;
        notes?: string | null;
        ownerId?: string | null;
      } = {};

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
      }
      if (patch.notes !== undefined && patch.notes !== row.notes) {
        before.notes = row.notes;
        after.notes = patch.notes;
        update.notes = patch.notes;
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

      return personSchema.parse(serializePerson(updated));
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
