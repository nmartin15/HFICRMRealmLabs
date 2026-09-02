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
    personId: string | null;
    userId: string | null;
    type: ActivityType;
    payload: ActivityMutationPayload;
  },
): Promise<typeof activities.$inferSelect> {
  const [row] = await db
    .insert(activities)
    .values({
      personId: input.personId,
      userId: input.userId,
      type: input.type,
      payload: input.payload,
      occurredAt: new Date(input.payload.when),
    })
    .returning();

  if (!row) {
    throw new Error("Failed to write activity");
  }
  return row;
}
