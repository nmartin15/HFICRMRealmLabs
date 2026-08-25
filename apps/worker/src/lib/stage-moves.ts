import {
  allocationStageOnInboundReply,
  allocationStageOnMeetingCreated,
} from "@realm-labs/contracts";
import { eq } from "drizzle-orm";
import { allocationCards, type Database } from "@realm-labs/db";
import { writeActivity } from "./activity.js";

type Actor = { id: string; email: string };

export async function maybeMoveOnInboundReply(
  db: Database,
  input: { personId: string; actor: Actor; when: Date },
): Promise<void> {
  const rows = await db
    .select()
    .from(allocationCards)
    .where(eq(allocationCards.personId, input.personId))
    .limit(1);
  const card = rows[0];
  if (!card) {
    return;
  }
  const next = allocationStageOnInboundReply(card.stage);
  if (!next) {
    return;
  }

  await db
    .update(allocationCards)
    .set({ stage: next })
    .where(eq(allocationCards.id, card.id));

  await writeActivity(db, {
    personId: input.personId,
    userId: input.actor.id,
    type: "stage_change",
    payload: {
      who: { id: input.actor.id, email: input.actor.email },
      what: "allocation.stage_change",
      when: input.when.toISOString(),
      before: { stage: card.stage },
      after: {
        stage: next,
        automatic: true,
        reason: "inbound_reply",
      },
    },
  });
}

export async function maybeMoveOnMeetingCreated(
  db: Database,
  input: { personId: string; actor: Actor; when: Date },
): Promise<void> {
  const rows = await db
    .select()
    .from(allocationCards)
    .where(eq(allocationCards.personId, input.personId))
    .limit(1);
  const card = rows[0];
  if (!card) {
    return;
  }
  const next = allocationStageOnMeetingCreated(card.stage);
  if (!next) {
    return;
  }

  await db
    .update(allocationCards)
    .set({ stage: next })
    .where(eq(allocationCards.id, card.id));

  await writeActivity(db, {
    personId: input.personId,
    userId: input.actor.id,
    type: "stage_change",
    payload: {
      who: { id: input.actor.id, email: input.actor.email },
      what: "allocation.stage_change",
      when: input.when.toISOString(),
      before: { stage: card.stage },
      after: {
        stage: next,
        automatic: true,
        reason: "meeting_created",
      },
    },
  });
}
