import {
  allocationBoardCardSchema,
  allocationBoardResponseSchema,
  allocationCardIdParamsSchema,
  allocationCardSchema,
  allocationStageMoveBodySchema,
  canMoveAllocationStage,
  canSendAppLinkWithoutCall,
  canViewCard,
  createAllocationApplicantBodySchema,
  createApplicantResponseSchema,
  daysInStage,
  decideBodySchema,
  isAllocationOpenStage,
  isOnAllocationBoard,
  okResponseSchema,
  stageEnteredAtIso,
  type AllocationBoardCard,
  type AllocationOpenStage,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  activities,
  allocationCards,
  people,
  tasks,
  type Database,
} from "@realm-labs/db";
import { createManualApplicant } from "../lib/applicants.js";
import { applyDecision } from "../lib/routing.js";
import {
  serializeAllocationCard,
  serializePerson,
  stageAfterFromPayload,
} from "../lib/serialize.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";
import { writeActivity } from "../lib/activity.js";

function emptyColumns(): AllocationBoardResponseColumns {
  return {
    applied: [],
    contacted: [],
    in_conversation: [],
    decision: [],
  };
}

type AllocationBoardResponseColumns = {
  applied: AllocationBoardCard[];
  contacted: AllocationBoardCard[];
  in_conversation: AllocationBoardCard[];
  decision: AllocationBoardCard[];
};

async function requireAllocationCard(db: Database, id: string) {
  const rows = await db
    .select()
    .from(allocationCards)
    .where(eq(allocationCards.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw httpError(404, "NOT_FOUND", "Allocation card not found");
  }
  return row;
}

async function toBoardCards(
  db: Database,
  rows: Array<{
    card: typeof allocationCards.$inferSelect;
    person: typeof people.$inferSelect;
  }>,
): Promise<AllocationBoardCard[]> {
  if (rows.length === 0) {
    return [];
  }

  const personIds = rows.map((row) => row.person.id);
  const now = new Date();

  const [taskRows, stageChangeRows] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(
        and(
          inArray(tasks.personId, personIds),
          eq(tasks.status, "open"),
        ),
      )
      .orderBy(asc(tasks.dueAt)),
    db
      .select()
      .from(activities)
      .where(
        and(
          inArray(activities.personId, personIds),
          eq(activities.type, "stage_change"),
        ),
      ),
  ]);

  const nextTaskByPerson = new Map<string, { kind: typeof taskRows[number]["kind"]; at: string }>();
  for (const task of taskRows) {
    if (!nextTaskByPerson.has(task.personId)) {
      nextTaskByPerson.set(task.personId, {
        kind: task.kind,
        at: task.dueAt.toISOString(),
      });
    }
  }

  const lastStageChangeByPerson = new Map<
    string,
    { occurredAt: string; afterStage: unknown }
  >();
  for (const change of stageChangeRows) {
    const occurredAt = change.occurredAt.toISOString();
    const existing = lastStageChangeByPerson.get(change.personId);
    if (!existing || occurredAt > existing.occurredAt) {
      lastStageChangeByPerson.set(change.personId, {
        occurredAt,
        afterStage: stageAfterFromPayload(change.payload),
      });
    }
  }

  return rows.map((row) => {
    const card = serializeAllocationCard(row.card);
    const person = serializePerson(row.person);
    const enteredAt = stageEnteredAtIso({
      cardCreatedAt: card.createdAt,
      currentStage: card.stage,
      lastStageChange: lastStageChangeByPerson.get(person.id) ?? null,
    });
    return allocationBoardCardSchema.parse({
      card,
      person: {
        id: person.id,
        firstName: person.firstName,
        lastName: person.lastName,
        company: person.company,
        leadTemp: person.leadTemp,
        budgetQualified: person.budgetQualified,
        programTrack: person.programTrack,
      },
      daysInStage: daysInStage(enteredAt, now),
      nextTaskAt: nextTaskByPerson.get(person.id)?.at ?? null,
      nextTaskKind: nextTaskByPerson.get(person.id)?.kind ?? null,
    });
  });
}

const listedPeople = and(
  isNull(people.deletedAt),
  eq(people.doNotContact, false),
  eq(people.programTrack, "allocation"),
);

export const allocationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/allocation",
    {
      schema: {
        response: { 200: allocationBoardResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      if (!canViewCard()) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }

      const rows = await app.db
        .select({
          card: allocationCards,
          person: people,
        })
        .from(allocationCards)
        .innerJoin(people, eq(allocationCards.personId, people.id))
        .where(listedPeople)
        .orderBy(asc(allocationCards.createdAt));

      const items = await toBoardCards(app.db, rows);
      const columns = emptyColumns();
      const closed: AllocationBoardCard[] = [];

      for (const item of items) {
        if (!isOnAllocationBoard(item.card.decision)) {
          continue;
        }
        if (isAllocationOpenStage(item.card.stage)) {
          columns[item.card.stage].push(item);
        } else {
          closed.push(item);
        }
      }

      return allocationBoardResponseSchema.parse({ columns, closed });
    },
  );

  app.post(
    "/allocation",
    {
      schema: {
        body: createAllocationApplicantBodySchema,
        response: { 200: createApplicantResponseSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      return createApplicantResponseSchema.parse(
        await createManualApplicant(app.db, actor, "allocation", req.body),
      );
    },
  );

  app.patch(
    "/allocation/:id/stage",
    {
      schema: {
        params: allocationCardIdParamsSchema,
        body: allocationStageMoveBodySchema,
        response: { 200: allocationCardSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      const card = await requireAllocationCard(app.db, req.params.id);
      const nextStage: AllocationOpenStage = req.body.stage;

      if (!canMoveAllocationStage(card.stage, nextStage)) {
        throw httpError(
          400,
          "INVALID_STAGE_MOVE",
          "Cards can only move between Applied, Contacted, In Conversation, and Decision",
        );
      }

      if (card.stage === nextStage) {
        return allocationCardSchema.parse(serializeAllocationCard(card));
      }

      const [updated] = await app.db
        .update(allocationCards)
        .set({ stage: nextStage })
        .where(eq(allocationCards.id, card.id))
        .returning();
      if (!updated) {
        throw httpError(404, "NOT_FOUND", "Allocation card not found");
      }

      const when = new Date();
      await writeActivity(app.db, {
        personId: card.personId,
        userId: actor.id,
        type: "stage_change",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "allocation.stage_change",
          when: when.toISOString(),
          before: { stage: card.stage },
          after: { stage: nextStage },
        },
      });

      return allocationCardSchema.parse(serializeAllocationCard(updated));
    },
  );

  app.post(
    "/allocation/:id/decide",
    {
      schema: {
        params: allocationCardIdParamsSchema,
        body: decideBodySchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      await applyDecision(app.db, actor, req.params.id, req.body);
      return { ok: true as const };
    },
  );

  app.post(
    "/allocation/:id/send-app-link",
    {
      schema: {
        params: allocationCardIdParamsSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      const card = await requireAllocationCard(app.db, req.params.id);

      if (!canSendAppLinkWithoutCall(card.stage)) {
        throw httpError(
          400,
          "INVALID_STAGE",
          "Send app link without call is only available from Contacted",
        );
      }

      await applyDecision(
        app.db,
        actor,
        card.id,
        { decision: "route_incubator" },
        { noCallAppLink: true },
      );
      return { ok: true as const };
    },
  );
};
