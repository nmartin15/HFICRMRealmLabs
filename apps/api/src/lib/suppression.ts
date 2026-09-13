import {
  canonicalEmail,
  planConsentGrant,
  type ConsentChannel,
  type ConsentSource,
  type SuppressionReason,
} from "@realm-labs/contracts";
import { eq, inArray } from "drizzle-orm";
import {
  emailSuppressionHash,
  emailSuppressions,
  findSuppression,
  personConsentEvents,
  personConsents,
  type Database,
} from "@realm-labs/db";

export {
  emailSuppressionHash,
  findSuppression,
  persistEmailSuppression as writeSuppression,
  purgePersonGraph,
} from "@realm-labs/db";

export async function suppressionReasonForEmail(
  db: Database,
  email: string,
  keyHex: string,
): Promise<SuppressionReason | null> {
  const row = await findSuppression(db, emailSuppressionHash(email, keyHex));
  return row?.reason ?? null;
}

export async function loadSuppressionReasons(
  db: Database,
  emails: readonly string[],
  keyHex: string,
): Promise<Map<string, SuppressionReason>> {
  const hashes = emails.map((email) => emailSuppressionHash(email, keyHex));
  if (hashes.length === 0) {
    return new Map();
  }
  const rows = await db
    .select()
    .from(emailSuppressions)
    .where(inArray(emailSuppressions.emailHash, hashes));
  const byHash = new Map(rows.map((row) => [row.emailHash, row.reason] as const));
  const result = new Map<string, SuppressionReason>();
  for (const email of emails) {
    const reason = byHash.get(emailSuppressionHash(email, keyHex));
    if (reason) {
      result.set(canonicalEmail(email), reason);
    }
  }
  return result;
}

export async function grantPersonConsent(
  db: Database,
  input: {
    personId: string;
    email: string;
    keyHex: string;
    channel: ConsentChannel;
    source: ConsentSource;
    occurredAt: Date;
  },
): Promise<void> {
  const plan = planConsentGrant({
    channel: input.channel,
    source: input.source,
  });
  const emailHash = emailSuppressionHash(input.email, input.keyHex);
  await db
    .insert(personConsents)
    .values({
      personId: input.personId,
      channel: plan.channel,
      status: plan.status,
      source: plan.source,
      grantedAt: input.occurredAt,
    })
    .onConflictDoUpdate({
      target: [personConsents.personId, personConsents.channel],
      set: {
        status: plan.status,
        source: plan.source,
        grantedAt: input.occurredAt,
        withdrawnAt: null,
      },
    });
  await db.insert(personConsentEvents).values({
    personId: input.personId,
    emailHash,
    channel: plan.channel,
    status: plan.status,
    source: plan.source,
    occurredAt: input.occurredAt,
  });
}
