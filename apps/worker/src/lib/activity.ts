import type { ActivityType } from "@realm-labs/contracts";
import { activities, type Database } from "@realm-labs/db";

export type ActivityMutationPayload = {
  who: { id: string; email: string };
  what: string;
  when: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export async function writeActivity(
  db: Database,
  input: {
    personId: string;
    userId: string | null;
    type: ActivityType;
    payload: ActivityMutationPayload;
  },
): Promise<void> {
  await db.insert(activities).values({
    personId: input.personId,
    userId: input.userId,
    type: input.type,
    payload: input.payload,
    occurredAt: new Date(input.payload.when),
  });
}
