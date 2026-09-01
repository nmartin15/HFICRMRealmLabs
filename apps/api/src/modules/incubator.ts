import {
  canViewCard,
  createApplicantResponseSchema,
  createIncubatorApplicantBodySchema,
  daysInStage,
  evaluateIncubatorMove,
  incubatorBoardCardSchema,
  incubatorBoardResponseSchema,
  incubatorBoardTotals,
  incubatorCardIdParamsSchema,
  incubatorCardSchema,
  incubatorStageMoveBodySchema,
  isIncubatorOpenStage,
  stageEnteredAtIso,
  type IncubatorBoardCard,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  activities,
  allocationCards,
  incubatorCards,
  people,
  type Database,
} from "@realm-labs/db";
import {
  serializeIncubatorCard,
  serializePerson,
  stageAfterFromPayload,
} from "../lib/serialize.js";
import { createManualApplicant } from "../lib/applicants.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";
import { writeActivity } from "../lib/activity.js";

type IncubatorBoardColumns = {
  sent: IncubatorBoardCard[];
  applied: IncubatorBoardCard[];
  approved: IncubatorBoardCard[];
};

function emptyColumns(): IncubatorBoardColumns {
  return {
    sent: [],
    applied: [],
    approved: [],
  };
}

const listedPeople = and(
  isNull(people.deletedAt),
  eq(people.doNotContact, false),
  eq(people.programTrack, "incubator"),
);

async function requireIncubatorCard(db: Database, id: string) {
  const rows = await db
    .select()
    .from(incubatorCards)
    .where(eq(incubatorCards.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw httpError(404, "NOT_FOUND", "Incubator card not found");
  }
  return row;
}

async function toBoardCards(
  db: Database,
  rows: Array<{
    card: typeof incubatorCards.$inferSelect;
    person: typeof people.$inferSelect;
    noCallAppLink: boolean | null;
  }>,
): Promise<IncubatorBoardCard[]> {
  if (rows.length === 0) {
    return [];
  }

  const personIds = rows.map((row) => row.person.id);
  const now = new Date();
  const stageChangeRows = await db
    .select()
    .from(activities)
    .where(
      and(
        inArray(activities.personId, personIds),
        eq(activities.type, "stage_change"),
      ),
    );

  const lastStageChangeByPerson = new Map<
    string,
    { occurredAt: string; afterStage: unknown }
  >();
  for (const change of stageChangeRows) {
    const payload = change.payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      !("what" in payload) ||
      payload.what !== "incubator.stage_change"
    ) {
      continue;
    }
    const occurredAt = change.occurredAt.toISOString();
    const existing = lastStageChangeByPerson.get(change.personId);
    if (!existing || occurredAt > existing.occurredAt) {
      lastStageChangeByPerson.set(change.personId, {
        occurredAt,
        afterStage: stageAfterFromPayload(payload),
      });
    }
  }

  return rows.map((row) => {
    const card = serializeIncubatorCard(row.card);
    const person = serializePerson(row.person);
    const enteredAt = stageEnteredAtIso({
      cardCreatedAt: card.routedAt,
      currentStage: card.stage,
      lastStageChange: lastStageChangeByPerson.get(person.id) ?? null,
    });
    return incubatorBoardCardSchema.parse({
      card,
      person: {
        id: person.id,
        firstName: person.firstName,
        lastName: person.lastName,
        budgetQualified: person.budgetQualified,
        programTrack: person.programTrack,
      },
      noCallAppLink: row.noCallAppLink ?? false,
      daysInStage: daysInStage(enteredAt, now),
    });
  });
}

export const incubatorRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/incubator",
    {
      schema: {
        response: { 200: incubatorBoardResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      if (!canViewCard()) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }

      const rows = await app.db
        .select({
          card: incubatorCards,
          person: people,
          noCallAppLink: allocationCards.noCallAppLink,
        })
        .from(incubatorCards)
        .innerJoin(people, eq(incubatorCards.personId, people.id))
        .leftJoin(allocationCards, eq(allocationCards.personId, people.id))
        .where(listedPeople)
        .orderBy(asc(incubatorCards.routedAt));

      const items = await toBoardCards(app.db, rows);
      const columns = emptyColumns();
      const closed: IncubatorBoardCard[] = [];

      for (const item of items) {
        if (isIncubatorOpenStage(item.card.stage)) {
          columns[item.card.stage].push(item);
        } else {
          closed.push(item);
        }
      }

      const totals = incubatorBoardTotals({
        sent: columns.sent.map((item) => ({ priceUsd: item.card.priceUsd })),
        applied: columns.applied.map((item) => ({
          priceUsd: item.card.priceUsd,
        })),
        approved: columns.approved.map((item) => ({
          priceUsd: item.card.priceUsd,
        })),
      });

      return incubatorBoardResponseSchema.parse({ columns, closed, totals });
    },
  );

  app.post(
    "/incubator",
    {
      schema: {
        body: createIncubatorApplicantBodySchema,
        response: { 200: createApplicantResponseSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      return createApplicantResponseSchema.parse(
        await createManualApplicant(app.db, actor, "incubator", req.body),
      );
    },
  );

  app.patch(
    "/incubator/:id/stage",
    {
      schema: {
        params: incubatorCardIdParamsSchema,
        body: incubatorStageMoveBodySchema,
        response: { 200: incubatorCardSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      const card = await requireIncubatorCard(app.db, req.params.id);

      const personRows = await app.db
        .select()
        .from(people)
        .where(eq(people.id, card.personId))
        .limit(1);
      const person = personRows[0];
      if (!person || person.deletedAt) {
        throw httpError(404, "NOT_FOUND", "Person not found");
      }

      const allocRows = await app.db
        .select({ noCallAppLink: allocationCards.noCallAppLink })
        .from(allocationCards)
        .where(eq(allocationCards.personId, card.personId))
        .limit(1);

      const result = evaluateIncubatorMove({
        from: card.stage,
        to: req.body.stage,
        budgetQualified: person.budgetQualified,
        noCallAppLink: allocRows[0]?.noCallAppLink ?? false,
        applicationRef: card.applicationRef,
        tier: card.tier,
        priceUsd: card.priceUsd,
        closeReason: req.body.closeReason,
        nextApplicationRef: req.body.applicationRef,
      });

      if (!result.ok) {
        throw httpError(result.status, result.code, result.message);
      }

      if (card.stage === result.stage) {
        return incubatorCardSchema.parse(serializeIncubatorCard(card));
      }

      const when = new Date();
      const [updated] = await app.db
        .update(incubatorCards)
        .set({
          stage: result.stage,
          applicationRef: result.applicationRef,
          tier: result.tier,
          priceUsd: result.priceUsd,
          closeReason: result.closeReason,
          closedAt: result.closed ? when : null,
        })
        .where(eq(incubatorCards.id, card.id))
        .returning();
      if (!updated) {
        throw httpError(404, "NOT_FOUND", "Incubator card not found");
      }

      if (result.closed) {
        await app.db
          .update(people)
          .set({ programTrack: null })
          .where(eq(people.id, card.personId));
      }

      await writeActivity(app.db, {
        personId: card.personId,
        userId: actor.id,
        type: "stage_change",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "incubator.stage_change",
          when: when.toISOString(),
          before: {
            stage: card.stage,
            applicationRef: card.applicationRef,
            tier: card.tier,
            priceUsd: card.priceUsd,
            closeReason: card.closeReason,
          },
          after: {
            stage: result.stage,
            applicationRef: result.applicationRef,
            tier: result.tier,
            priceUsd: result.priceUsd,
            closeReason: result.closeReason,
          },
        },
      });

      return incubatorCardSchema.parse(serializeIncubatorCard(updated));
    },
  );
};
