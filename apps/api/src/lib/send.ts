import {
  canonicalEmail,
  hasNewsletterGrant,
  hasStayInTouch,
  kickboxBlocksSend,
  outboundSendResponseSchema,
  parseKickboxResult,
  planOutboundSend,
  SEND_BLOCKED_CODE,
  type CampaignSendPurpose,
} from "@realm-labs/contracts";
import {
  hmacSha256Hex,
  outboundSends,
  people,
  personConsents,
  type Database,
} from "@realm-labs/db";
import { eq } from "drizzle-orm";
import { httpError } from "../plugins/error.js";
import { suppressionReasonForEmail } from "./suppression.js";

export async function sendEmail(
  db: Database,
  input: {
    to: string;
    purpose: CampaignSendPurpose;
    subject: string;
    bodyText: string;
    emailHashKey: string;
    personId?: string | null;
    tag?: string | null;
    doNotContact: boolean;
  },
): Promise<{ id: string; status: "queued" }> {
  const toEmail = canonicalEmail(input.to);
  const suppressionReason = await suppressionReasonForEmail(
    db,
    toEmail,
    input.emailHashKey,
  );
  const consentRows = input.personId
    ? await db
        .select({
          channel: personConsents.channel,
          status: personConsents.status,
        })
        .from(personConsents)
        .where(eq(personConsents.personId, input.personId))
    : [];
  let emailUndeliverable = false;
  if (input.personId) {
    const personRows = await db
      .select({
        emailVerificationResult: people.emailVerificationResult,
      })
      .from(people)
      .where(eq(people.id, input.personId))
      .limit(1);
    emailUndeliverable = kickboxBlocksSend(
      parseKickboxResult(personRows[0]?.emailVerificationResult),
    );
  }
  const plan = planOutboundSend({
    suppressionReason,
    purpose: input.purpose,
    stayInTouch: hasStayInTouch(consentRows),
    doNotContact: input.doNotContact,
    newsletterGranted: hasNewsletterGrant(consentRows),
    emailUndeliverable,
    isSeed: false,
  });
  if (!plan.ok) {
    throw httpError(403, plan.code, plan.message);
  }

  const emailHash = hmacSha256Hex(input.emailHashKey, toEmail);
  // Enqueue is not send. The worker claims queued → sending with
  // WHERE status = queued, then calls Postmark, then marks sent
  // while the row is still sending.
  try {
    const inserted = await db
      .insert(outboundSends)
      .values({
        personId: input.personId ?? null,
        emailHash,
        toEmail,
        purpose: input.purpose,
        subject: input.subject,
        bodyText: input.bodyText,
        tag: input.tag ?? null,
      })
      .returning({ id: outboundSends.id });
    const row = inserted[0];
    if (!row) {
      throw httpError(500, "INTERNAL", "Failed to queue send");
    }
    return outboundSendResponseSchema.parse({ id: row.id, status: "queued" });
  } catch (error) {
    if (isSuppressedConstraint(error)) {
      throw httpError(403, SEND_BLOCKED_CODE, "Address is suppressed");
    }
    throw error;
  }
}

function isSuppressedConstraint(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ("code" in current && current.code === "23514") {
      return true;
    }
    if ("message" in current && typeof current.message === "string") {
      if (current.message.includes("SUPPRESSED")) {
        return true;
      }
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
