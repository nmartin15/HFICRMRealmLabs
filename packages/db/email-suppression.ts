import {
  canonicalEmail,
  planSuppressionWrite,
  SUPPRESSION_POLICIES,
  type SuppressionReason,
  type SuppressionSource,
} from "@realm-labs/contracts";
import { eq } from "drizzle-orm";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { hmacSha256Hex } from "./crypto";
import type { Database } from "./client";
import { blockQueuedOutboundSends } from "./outbound-sends";
import {
  activities,
  allocationCards,
  emailSuppressionEvents,
  emailSuppressions,
  emailThreads,
  incubatorCards,
  meetings,
  people,
  personCampaignTags,
  tasks,
} from "./schema";

export function emailSuppressionHash(email: string, keyHex: string): string {
  return hmacSha256Hex(keyHex, canonicalEmail(email));
}

export async function findSuppression(db: Database, emailHash: string) {
  const rows = await db
    .select()
    .from(emailSuppressions)
    .where(eq(emailSuppressions.emailHash, emailHash))
    .limit(1);
  return rows[0] ?? null;
}

export async function persistEmailSuppression(
  db: Database,
  input: {
    email: string;
    keyHex: string;
    reason: SuppressionReason;
    source: SuppressionSource;
    occurredAt: Date;
    createdBy: string | null;
    actorEmail?: string;
    personId: string | null;
    payload?: Record<string, unknown>;
    resumeStorageDir?: string;
  },
): Promise<{
  emailHash: string;
  nextReason: SuppressionReason;
  purgePerson: boolean;
}> {
  const emailHash = emailSuppressionHash(input.email, input.keyHex);
  const existing = await findSuppression(db, emailHash);
  const plan = planSuppressionWrite({
    currentReason: existing?.reason ?? null,
    incomingReason: input.reason,
    alreadyPurged: Boolean(existing?.purgedAt),
  });

  let suppressionId = existing?.id;
  if (!existing) {
    const [created] = await db
      .insert(emailSuppressions)
      .values({
        emailHash,
        reason: plan.nextReason,
        source: input.source,
        occurredAt: input.occurredAt,
        createdBy: input.createdBy,
      })
      .returning();
    if (!created) {
      throw new Error("Failed to write email suppression");
    }
    suppressionId = created.id;
  } else if (plan.reasonChanged) {
    await db
      .update(emailSuppressions)
      .set({
        reason: plan.nextReason,
        source: input.source,
        occurredAt: input.occurredAt,
      })
      .where(eq(emailSuppressions.id, existing.id));
  }

  if (!suppressionId) {
    throw new Error("Failed to write email suppression");
  }

  await db.insert(emailSuppressionEvents).values({
    suppressionId,
    emailHash,
    reason: input.reason,
    source: input.source,
    occurredAt: input.occurredAt,
    createdBy: input.createdBy,
    payload: {
      ...(input.payload ?? {}),
      email: canonicalEmail(input.email),
    },
  });

  if (plan.setDoNotContact && input.personId) {
    await db
      .update(people)
      .set({ doNotContact: true, programTrack: null })
      .where(eq(people.id, input.personId));
  }

  if (SUPPRESSION_POLICIES[plan.nextReason].blockAllSends) {
    await blockQueuedOutboundSends(db, emailHash);
    if (input.personId) {
      await db
        .delete(personCampaignTags)
        .where(eq(personCampaignTags.personId, input.personId));
    }
  }

  if (plan.purgePerson && input.personId) {
    await purgePersonGraph(db, {
      personId: input.personId,
      resumeStorageDir: input.resumeStorageDir,
    });
    await db
      .update(emailSuppressions)
      .set({ purgedAt: input.occurredAt })
      .where(eq(emailSuppressions.id, suppressionId));
  } else if (plan.purgePerson && !input.personId) {
    await db
      .update(emailSuppressions)
      .set({ purgedAt: existing?.purgedAt ?? input.occurredAt })
      .where(eq(emailSuppressions.id, suppressionId));
  }

  await db.insert(activities).values({
    personId: plan.purgePerson ? null : input.personId,
    userId: input.createdBy,
    type: "field_change",
    payload: {
      who: {
        id: input.createdBy ?? "system",
        email: input.actorEmail ?? input.source,
      },
      what: "email.suppress",
      when: input.occurredAt.toISOString(),
      before: existing
        ? {
            reason: existing.reason,
            purgedAt: existing.purgedAt?.toISOString() ?? null,
          }
        : null,
      after: {
        emailHash,
        reason: plan.nextReason,
        purged: plan.purgePerson,
      },
    },
    occurredAt: input.occurredAt,
  });

  return {
    emailHash,
    nextReason: plan.nextReason,
    purgePerson: plan.purgePerson,
  };
}

export async function purgePersonGraph(
  db: Database,
  input: { personId: string; resumeStorageDir?: string },
): Promise<void> {
  await db
    .update(emailThreads)
    .set({ personId: null })
    .where(eq(emailThreads.personId, input.personId));
  await db.delete(tasks).where(eq(tasks.personId, input.personId));
  await db.delete(meetings).where(eq(meetings.personId, input.personId));
  await db
    .delete(allocationCards)
    .where(eq(allocationCards.personId, input.personId));
  await db
    .delete(incubatorCards)
    .where(eq(incubatorCards.personId, input.personId));
  await db.delete(activities).where(eq(activities.personId, input.personId));
  await db.delete(people).where(eq(people.id, input.personId));
  if (input.resumeStorageDir) {
    await rm(join(input.resumeStorageDir, input.personId), {
      recursive: true,
      force: true,
    });
  }
}
