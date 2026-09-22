import {
  canonicalEmail,
  duplicatePostmarkNeedsTombstone,
  planPostmarkWebhook,
  planSoftBounceSuppress,
  parsePostmarkWebhookEvent,
} from "@realm-labs/contracts";
import {
  emailDeliveryEvents,
  findPersonByEmail,
  hmacSha256Hex,
  outboundSends,
  persistStayInTouchOptOut,
  type Database,
} from "@realm-labs/db";
import { and, count, eq } from "drizzle-orm";
import { suppressionReasonForEmail, writeSuppression } from "./suppression.js";

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ("code" in current && current.code === "23505") {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

async function applyPlannedSuppression(
  db: Database,
  input: {
    planned: ReturnType<typeof planPostmarkWebhook>;
    email: string;
    emailHash: string;
    emailHashKey: string;
    personId: string | null;
    messageId: string | null;
    bounceType: string | null;
  },
): Promise<void> {
  const occurredAt = new Date();
  if (input.planned.kind === "hard_bounce") {
    await writeSuppression(db, {
      email: input.email,
      keyHex: input.emailHashKey,
      reason: "hard_bounced",
      source: "postmark",
      occurredAt,
      createdBy: null,
      actorEmail: "postmark",
      personId: input.personId,
      payload: { messageId: input.messageId, type: input.bounceType },
    });
    return;
  }
  if (input.planned.kind === "complaint") {
    await writeSuppression(db, {
      email: input.email,
      keyHex: input.emailHashKey,
      reason: "complained",
      source: "postmark",
      occurredAt,
      createdBy: null,
      actorEmail: "postmark",
      personId: input.personId,
      payload: { messageId: input.messageId },
    });
    return;
  }
  if (input.planned.kind === "unsubscribe") {
    await writeSuppression(db, {
      email: input.email,
      keyHex: input.emailHashKey,
      reason: "unsubscribed",
      source: "postmark",
      occurredAt,
      createdBy: null,
      actorEmail: "postmark",
      personId: input.personId,
      payload: { messageId: input.messageId },
    });
    return;
  }
  if (input.planned.kind === "stay_in_touch_opt_out") {
    if (input.personId) {
      await persistStayInTouchOptOut(db, {
        personId: input.personId,
        when: occurredAt,
      });
    }
    return;
  }
  if (input.planned.kind !== "soft_bounce") {
    return;
  }
  const [row] = await db
    .select({ n: count() })
    .from(emailDeliveryEvents)
    .where(
      and(
        eq(emailDeliveryEvents.emailHash, input.emailHash),
        eq(emailDeliveryEvents.recordType, "soft_bounce"),
      ),
    );
  if (planSoftBounceSuppress(Number(row?.n ?? 0))) {
    await writeSuppression(db, {
      email: input.email,
      keyHex: input.emailHashKey,
      reason: "hard_bounced",
      source: "postmark",
      occurredAt,
      createdBy: null,
      actorEmail: "postmark",
      personId: input.personId,
      payload: { softBounces: Number(row?.n ?? 0) },
    });
  }
}

async function ensureDuplicateTombstone(
  db: Database,
  input: {
    planned: ReturnType<typeof planPostmarkWebhook>;
    emailHashKey: string;
    eventType: string | null;
  },
): Promise<{ ok: true; duplicate: true }> {
  if (
    input.planned.kind === "ignore" ||
    input.planned.kind === "delivery" ||
    input.planned.kind === "soft_bounce"
  ) {
    return { ok: true, duplicate: true };
  }
  const currentReason = await suppressionReasonForEmail(
    db,
    input.planned.email,
    input.emailHashKey,
  );
  if (
    !duplicatePostmarkNeedsTombstone({
      kind: input.planned.kind,
      currentReason,
    })
  ) {
    return { ok: true, duplicate: true };
  }
  const person = await findPersonByEmail(db, input.planned.email);
  const emailHash = hmacSha256Hex(
    input.emailHashKey,
    canonicalEmail(input.planned.email),
  );
  await applyPlannedSuppression(db, {
    planned: input.planned,
    email: input.planned.email,
    emailHash,
    emailHashKey: input.emailHashKey,
    personId: person?.id ?? null,
    messageId: input.planned.messageId,
    bounceType: input.eventType,
  });
  return { ok: true, duplicate: true };
}

export async function applyPostmarkWebhook(
  db: Database,
  input: {
    body: unknown;
    emailHashKey: string;
    traceHeader: string | string[] | undefined;
  },
): Promise<{ ok: true; duplicate?: boolean }> {
  const event = parsePostmarkWebhookEvent(input.body);
  if (!event) {
    return { ok: true };
  }
  const planned = planPostmarkWebhook(event);
  const trace =
    headerValue(input.traceHeader)?.trim() ||
    (event.MessageID
      ? `${event.RecordType}:${event.MessageID}`
      : `${event.RecordType}:${event.Email ?? event.Recipient ?? "none"}:${event.Type ?? ""}`);

  const existing = await db
    .select({ id: emailDeliveryEvents.id })
    .from(emailDeliveryEvents)
    .where(eq(emailDeliveryEvents.providerTraceId, trace))
    .limit(1);
  if (existing[0]) {
    return ensureDuplicateTombstone(db, {
      planned,
      emailHashKey: input.emailHashKey,
      eventType: event.Type ?? null,
    });
  }

  if (planned.kind === "ignore") {
    return { ok: true };
  }

  const email = planned.email;
  const person = await findPersonByEmail(db, email);
  const sendRows = planned.messageId
    ? await db
        .select({
          id: outboundSends.id,
          emailHash: outboundSends.emailHash,
          isSeed: outboundSends.isSeed,
        })
        .from(outboundSends)
        .where(eq(outboundSends.providerMessageId, planned.messageId))
        .limit(1)
    : [];
  const send = sendRows[0] ?? null;
  const emailHash =
    send?.emailHash ?? hmacSha256Hex(input.emailHashKey, canonicalEmail(email));

  const recordType =
    planned.kind === "hard_bounce"
      ? "bounce"
      : planned.kind === "soft_bounce"
        ? "soft_bounce"
        : planned.kind === "complaint"
          ? "complaint"
          : planned.kind === "unsubscribe" ||
              planned.kind === "stay_in_touch_opt_out"
            ? "unsubscribe"
            : "delivery";

  try {
    await db.transaction(async (tx) => {
      const typedTx = tx as unknown as Database;
      await typedTx.insert(emailDeliveryEvents).values({
        emailHash,
        personId: person?.id ?? null,
        outboundSendId: send?.id ?? null,
        recordType,
        bounceType: event.Type ?? null,
        providerMessageId: planned.messageId,
        providerTraceId: trace,
        isSeed: send?.isSeed ?? false,
        payload: JSON.parse(JSON.stringify(event)) as Record<string, unknown>,
      });
      await applyPlannedSuppression(typedTx, {
        planned,
        email,
        emailHash,
        emailHashKey: input.emailHashKey,
        personId: person?.id ?? null,
        messageId: planned.messageId,
        bounceType: event.Type ?? null,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return ensureDuplicateTombstone(db, {
        planned,
        emailHashKey: input.emailHashKey,
        eventType: event.Type ?? null,
      });
    }
    throw error;
  }
  return { ok: true };
}
