import {
  decide,
  decideBodySchema,
  todayIsoInDisplayZone,
  type DecideBody,
  type DecideSuccess,
} from "@realm-labs/contracts";
import { eq } from "drizzle-orm";
import {
  allocationCards,
  incubatorCards,
  people,
  type Database,
} from "@realm-labs/db";
import type { AuthedUser } from "../plugins/auth.js";
import { httpError } from "../plugins/error.js";
import { writeActivity } from "./activity.js";

export async function applyDecision(
  db: Database,
  actor: AuthedUser,
  cardId: string,
  body: DecideBody,
  extras?: { noCallAppLink?: boolean },
): Promise<DecideSuccess> {
  const parsed = decideBodySchema.parse(body);
  const cardRows = await db
    .select()
    .from(allocationCards)
    .where(eq(allocationCards.id, cardId))
    .limit(1);
  const card = cardRows[0];
  if (!card) {
    throw httpError(404, "NOT_FOUND", "Allocation card not found");
  }

  const incubRows = await db
    .select({ id: incubatorCards.id })
    .from(incubatorCards)
    .where(eq(incubatorCards.personId, card.personId))
    .limit(1);

  const result = decide({
    ...parsed,
    cardId: card.id,
    hasIncubatorCard: Boolean(incubRows[0]),
    today: todayIsoInDisplayZone(new Date()),
  });

  if (!result.ok) {
    throw httpError(result.status, result.code, result.message);
  }

  const when = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(allocationCards)
        .set({
          stage: result.allocation.stage,
          decision: result.allocation.decision,
          decidedAt: when,
          decidedBy: actor.id,
          passReason: result.allocation.passReason,
          nurtureFollowUpAt: result.allocation.nurtureFollowUpAt,
          ...(extras?.noCallAppLink ? { noCallAppLink: true } : {}),
        })
        .where(eq(allocationCards.id, card.id));

      if (result.person) {
        await tx
          .update(people)
          .set({ doNotContact: true })
          .where(eq(people.id, card.personId));
      }

      if (result.incubator) {
        await tx.insert(incubatorCards).values({
          personId: card.personId,
          stage: result.incubator.stage,
          tier: result.incubator.tier,
          priceUsd: result.incubator.priceUsd,
          routingDetail: result.incubator.routingDetail,
          routedAt: when,
        });
      }

      const typedTx = tx as unknown as Database;

      if (card.stage !== result.allocation.stage) {
        await writeActivity(typedTx, {
          personId: card.personId,
          userId: actor.id,
          type: "stage_change",
          payload: {
            who: { id: actor.id, email: actor.email },
            what: "allocation.stage_change",
            when: when.toISOString(),
            before: { stage: card.stage },
            after: { stage: result.allocation.stage },
          },
        });
      }

      await writeActivity(typedTx, {
        personId: card.personId,
        userId: actor.id,
        type: "decision",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "allocation.decide",
          when: when.toISOString(),
          before: {
            stage: card.stage,
            decision: card.decision,
          },
          after: {
            stage: result.allocation.stage,
            decision: result.allocation.decision,
            passReason: result.allocation.passReason,
            nurtureFollowUpAt: result.allocation.nurtureFollowUpAt,
            noCallAppLink: extras?.noCallAppLink ?? card.noCallAppLink,
            incubator: result.incubator,
          },
        },
      });

      if (result.person) {
        await writeActivity(typedTx, {
          personId: card.personId,
          userId: actor.id,
          type: "field_change",
          payload: {
            who: { id: actor.id, email: actor.email },
            what: "person.update",
            when: when.toISOString(),
            before: { doNotContact: false },
            after: { doNotContact: true },
          },
        });
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw httpError(
        409,
        "INCUBATOR_EXISTS",
        "Person already has an incubator card",
      );
    }
    throw err;
  }

  return result;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ("code" in current && current.code === "23505") {
      return true;
    }
    current =
      "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
  }
  return false;
}
