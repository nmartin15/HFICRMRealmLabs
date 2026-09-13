import {
  type ScoreTrigger,
} from "@realm-labs/contracts";
import { personScoreSnapshots, type Database } from "@realm-labs/db";
import { eq } from "drizzle-orm";
import { enqueueScoreRecompute, type SyncQueues } from "./queues.js";

export async function personHasScoreSnapshot(
  db: Database,
  personId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: personScoreSnapshots.id })
    .from(personScoreSnapshots)
    .where(eq(personScoreSnapshots.personId, personId))
    .limit(1);
  return Boolean(rows[0]);
}

export async function enqueuePersonScore(
  queues: SyncQueues,
  input: {
    personId: string;
    trigger: ScoreTrigger;
    computedBy?: string | null;
    delayMs?: number;
  },
): Promise<void> {
  await enqueueScoreRecompute(
    queues,
    {
      personId: input.personId,
      trigger: input.trigger,
      computedBy: input.computedBy ?? null,
    },
    input.delayMs,
  );
}
