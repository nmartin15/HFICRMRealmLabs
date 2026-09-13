import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import { outboundSends } from "./schema";

const IN_FLIGHT_STATUSES = ["queued", "sending"] as const;

export const OUTBOUND_DRAIN_LOCK_KEY = 872511;

export async function withOutboundDrainLock<T>(
  db: Database,
  run: () => Promise<T>,
): Promise<T> {
  await db.execute(sql`select pg_advisory_lock(872511)`);
  try {
    return await run();
  } finally {
    await db.execute(sql`select pg_advisory_unlock(872511)`);
  }
}

export async function blockQueuedOutboundSends(
  db: Database,
  emailHash: string,
): Promise<void> {
  await db
    .update(outboundSends)
    .set({ status: "blocked" })
    .where(
      and(
        eq(outboundSends.emailHash, emailHash),
        inArray(outboundSends.status, [...IN_FLIGHT_STATUSES]),
      ),
    );
}

export async function claimOutboundSendingIfQueued(
  db: Database,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .update(outboundSends)
    .set({ status: "sending" })
    .where(
      and(eq(outboundSends.id, id), eq(outboundSends.status, "queued")),
    )
    .returning({ id: outboundSends.id });
  return Boolean(row);
}

export async function markOutboundSentIfSending(
  db: Database,
  input: { id: string; providerMessageId: string; sentAt: Date },
): Promise<boolean> {
  const [row] = await db
    .update(outboundSends)
    .set({
      status: "sent",
      providerMessageId: input.providerMessageId,
      sentAt: input.sentAt,
    })
    .where(
      and(eq(outboundSends.id, input.id), eq(outboundSends.status, "sending")),
    )
    .returning({ id: outboundSends.id });
  return Boolean(row);
}

export async function releaseOutboundSendingIfSending(
  db: Database,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .update(outboundSends)
    .set({ status: "queued" })
    .where(
      and(eq(outboundSends.id, id), eq(outboundSends.status, "sending")),
    )
    .returning({ id: outboundSends.id });
  return Boolean(row);
}
