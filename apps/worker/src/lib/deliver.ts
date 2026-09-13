import {
  canonicalEmail,
  currentWeekRange,
  dailySendCap,
  DISPLAY_TIME_ZONE,
  deliverabilityRates,
  hasNewsletterGrant,
  hasStayInTouch,
  kickboxBlocksSend,
  parseKickboxResult,
  parseSeedEmails,
  planOutboundDeliver,
  planOutboundDrainRelease,
  remainingSendTicksInWindow,
  sendTickBudget,
  SUPPRESSION_POLICIES,
  zonedDayBoundsUtc,
  zonedLocalToUtc,
  zonedYmd,
  type CalendarYmd,
} from "@realm-labs/contracts";
import {
  emailDeliveryEvents,
  emailSuppressions,
  hmacSha256Hex,
  claimOutboundSendingIfQueued,
  markOutboundSentIfSending,
  outboundSends,
  people,
  personConsents,
  releaseOutboundSendingIfSending,
  withOutboundDrainLock,
  type Database,
} from "@realm-labs/db";
import { and, asc, eq, gte, lt, or, sql } from "drizzle-orm";
import { writeActivity } from "./activity.js";
import { sendWithPostmark } from "./postmark.js";
import type { Env } from "../env.js";

export function outboundEmailHash(emailHashKey: string, email: string): string {
  return hmacSha256Hex(emailHashKey, canonicalEmail(email));
}

async function suppressionReasonForEmail(
  db: Database,
  email: string,
  emailHashKey: string,
) {
  const hash = outboundEmailHash(emailHashKey, email);
  const rows = await db
    .select({ reason: emailSuppressions.reason })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.emailHash, hash))
    .limit(1);
  return rows[0]?.reason ?? null;
}

async function loadSendById(
  db: Database,
  id: string,
): Promise<typeof outboundSends.$inferSelect | null> {
  const rows = await db
    .select()
    .from(outboundSends)
    .where(eq(outboundSends.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function loadDeliveryPlan(
  db: Database,
  send: typeof outboundSends.$inferSelect,
  emailHashKey: string,
) {
  const suppressionReason = await suppressionReasonForEmail(
    db,
    send.toEmail,
    emailHashKey,
  );
  let doNotContact = false;
  let emailUndeliverable = false;
  if (send.personId) {
    const personRows = await db
      .select({
        doNotContact: people.doNotContact,
        deletedAt: people.deletedAt,
        emailVerificationResult: people.emailVerificationResult,
      })
      .from(people)
      .where(eq(people.id, send.personId))
      .limit(1);
    const person = personRows[0];
    doNotContact = !person || Boolean(person.deletedAt) || person.doNotContact;
    emailUndeliverable = kickboxBlocksSend(
      parseKickboxResult(person?.emailVerificationResult),
    );
  }
  const consentRows = send.personId
    ? await db
        .select({
          channel: personConsents.channel,
          status: personConsents.status,
        })
        .from(personConsents)
        .where(eq(personConsents.personId, send.personId))
    : [];
  return planOutboundDeliver({
    suppressionReason,
    purpose: send.purpose,
    stayInTouch: hasStayInTouch(consentRows),
    doNotContact,
    newsletterGranted: hasNewsletterGrant(consentRows),
    emailUndeliverable,
    isSeed: send.isSeed,
  });
}

async function prepareQueuedSend(
  db: Database,
  send: typeof outboundSends.$inferSelect,
  emailHashKey: string,
): Promise<{ ready: boolean }> {
  if (send.status !== "queued") {
    return { ready: false };
  }
  const plan = await loadDeliveryPlan(db, send, emailHashKey);
  if (plan.ok) {
    return { ready: true };
  }
  await db
    .update(outboundSends)
    .set({ status: "blocked" })
    .where(
      and(eq(outboundSends.id, send.id), eq(outboundSends.status, "queued")),
    );
  await writeActivity(db, {
    personId: send.personId,
    userId: null,
    type: "field_change",
    payload: {
      who: { id: "system", email: "outbound.deliver" },
      what: "outbound.send_blocked",
      when: new Date().toISOString(),
      before: { status: send.status },
      after: { status: "blocked", code: plan.code },
    },
  });
  return { ready: false };
}

async function todaySentCount(db: Database, now: Date): Promise<number> {
  const ymd = zonedYmd(now, DISPLAY_TIME_ZONE);
  const start = zonedLocalToUtc(ymd, DISPLAY_TIME_ZONE);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outboundSends)
    .where(
      and(
        eq(outboundSends.isSeed, false),
        or(
          and(
            eq(outboundSends.status, "sent"),
            gte(outboundSends.sentAt, start),
          ),
          eq(outboundSends.status, "sending"),
        ),
      ),
    );
  return row?.n ?? 0;
}

async function warmupDayIndex(db: Database, now: Date): Promise<number> {
  const first = await db
    .select({ sentAt: outboundSends.sentAt })
    .from(outboundSends)
    .where(and(eq(outboundSends.status, "sent"), eq(outboundSends.isSeed, false)))
    .orderBy(asc(outboundSends.sentAt))
    .limit(1);
  const sentAt = first[0]?.sentAt;
  if (!sentAt) {
    return 0;
  }
  const start = zonedYmd(sentAt, DISPLAY_TIME_ZONE);
  const today = zonedYmd(now, DISPLAY_TIME_ZONE);
  const a = Date.UTC(start.year, start.month - 1, start.day);
  const b = Date.UTC(today.year, today.month - 1, today.day);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function isoToYmd(iso: string): CalendarYmd {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

async function weekComplaintRate(db: Database, now: Date): Promise<number> {
  const week = currentWeekRange(now);
  const start = zonedDayBoundsUtc(isoToYmd(week.start), DISPLAY_TIME_ZONE);
  const end = zonedDayBoundsUtc(isoToYmd(week.end), DISPLAY_TIME_ZONE);
  const [sentRows, complaintRows] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(outboundSends)
      .where(
        and(
          eq(outboundSends.status, "sent"),
          eq(outboundSends.isSeed, false),
          gte(outboundSends.sentAt, start.start),
          lt(outboundSends.sentAt, end.end),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(emailDeliveryEvents)
      .where(
        and(
          eq(emailDeliveryEvents.isSeed, false),
          eq(emailDeliveryEvents.recordType, "complaint"),
          gte(emailDeliveryEvents.createdAt, start.start),
          lt(emailDeliveryEvents.createdAt, end.end),
        ),
      ),
  ]);
  return deliverabilityRates({
    sent: sentRows[0]?.n ?? 0,
    bounced: 0,
    complained: complaintRows[0]?.n ?? 0,
  }).complaintRate;
}

export async function deliverOutboundSend(
  db: Database,
  env: Env,
  sendId: string,
): Promise<boolean> {
  const send = await loadSendById(db, sendId);
  if (!send) {
    return false;
  }
  const prepared = await prepareQueuedSend(db, send, env.EMAIL_HASH_KEY);
  if (!prepared.ready) {
    return false;
  }
  if (!env.POSTMARK_SEND_ENABLED || !env.POSTMARK_SERVER_TOKEN) {
    return false;
  }
  const claimed = await claimOutboundSendingIfQueued(db, send.id);
  if (!claimed) {
    return false;
  }
  const latest = await loadSendById(db, send.id);
  if (!latest || latest.status !== "sending") {
    return false;
  }
  const stillAllowed = await loadDeliveryPlan(db, latest, env.EMAIL_HASH_KEY);
  if (!stillAllowed.ok) {
    await db
      .update(outboundSends)
      .set({ status: "blocked" })
      .where(
        and(eq(outboundSends.id, send.id), eq(outboundSends.status, "sending")),
      );
    await writeActivity(db, {
      personId: send.personId,
      userId: null,
      type: "field_change",
      payload: {
        who: { id: "system", email: "outbound.deliver" },
        what: "outbound.send_blocked",
        when: new Date().toISOString(),
        before: { status: "sending" },
        after: { status: "blocked", code: stillAllowed.code },
      },
    });
    return false;
  }
  const unsubscribeUrl = `${env.WEB_ORIGIN.replace(/\/$/, "")}/api/unsubscribe/${send.unsubscribeToken}`;
  let result: Awaited<ReturnType<typeof sendWithPostmark>>;
  try {
    result = await sendWithPostmark({
      serverToken: env.POSTMARK_SERVER_TOKEN,
      messageStream: env.POSTMARK_MESSAGE_STREAM,
      fromEmail: env.CAMPAIGN_FROM_EMAIL,
      fromName: env.CAMPAIGN_FROM_NAME,
      to: send.toEmail,
      subject: send.subject,
      text: send.bodyText,
      tag: send.tag,
      unsubscribeUrl,
      metadata: {
        sendId: send.id,
        purpose: send.purpose,
      },
    });
  } catch (error) {
    await writeActivity(db, {
      personId: send.personId,
      userId: null,
      type: "field_change",
      payload: {
        who: { id: "system", email: "outbound.deliver" },
        what: "outbound.send_uncertain",
        when: new Date().toISOString(),
        before: { status: "sending" },
        after: {
          error: error instanceof Error ? error.message : "unknown",
        },
      },
    });
    throw error;
  }
  if (!result.ok) {
    await releaseOutboundSendingIfSending(db, send.id);
    await writeActivity(db, {
      personId: send.personId,
      userId: null,
      type: "field_change",
      payload: {
        who: { id: "system", email: "outbound.deliver" },
        what: "outbound.send_failed",
        when: new Date().toISOString(),
        before: { status: "sending" },
        after: { error: result.message },
      },
    });
    return false;
  }
  const now = new Date();
  const marked = await markOutboundSentIfSending(db, {
    id: send.id,
    providerMessageId: result.messageId,
    sentAt: now,
  });
  if (!marked) {
    await writeActivity(db, {
      personId: send.personId,
      userId: null,
      type: "field_change",
      payload: {
        who: { id: "system", email: "outbound.deliver" },
        what: "outbound.send_not_sending",
        when: now.toISOString(),
        before: { status: "sending" },
        after: { status: "unchanged", providerMessageId: result.messageId },
      },
    });
    return false;
  }
  await writeActivity(db, {
    personId: send.personId,
    userId: null,
    type: "field_change",
    payload: {
      who: { id: "system", email: "outbound.deliver" },
      what: "outbound.sent",
      when: now.toISOString(),
      before: { status: "sending" },
      after: { status: "sent", providerMessageId: result.messageId },
    },
  });
  return true;
}

async function ensureSeeds(
  db: Database,
  env: Env,
  sample: typeof outboundSends.$inferSelect,
): Promise<void> {
  const seeds = parseSeedEmails(env.SEND_SEED_EMAILS);
  if (seeds.length === 0 || !sample.tag) {
    return;
  }
  for (const email of seeds) {
    const reason = await suppressionReasonForEmail(
      db,
      email,
      env.EMAIL_HASH_KEY,
    );
    if (reason && SUPPRESSION_POLICIES[reason].blockAllSends) {
      continue;
    }
    const existing = await db
      .select({ id: outboundSends.id })
      .from(outboundSends)
      .where(
        and(
          eq(outboundSends.toEmail, email),
          eq(outboundSends.tag, sample.tag),
          eq(outboundSends.isSeed, true),
        ),
      )
      .limit(1);
    if (existing[0]) {
      const row = await loadSendById(db, existing[0].id);
      if (row && row.status === "queued") {
        await deliverOutboundSend(db, env, row.id);
      }
      continue;
    }
    const inserted = await db
      .insert(outboundSends)
      .values({
        personId: null,
        emailHash: outboundEmailHash(env.EMAIL_HASH_KEY, email),
        toEmail: email,
        purpose: sample.purpose,
        subject: `[SEED] ${sample.subject}`,
        bodyText: sample.bodyText,
        tag: sample.tag,
        isSeed: true,
      })
      .returning();
    const seed = inserted[0];
    if (seed) {
      await deliverOutboundSend(db, env, seed.id);
    }
  }
}

async function stuckSendingCount(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outboundSends)
    .where(eq(outboundSends.status, "sending"));
  return row?.n ?? 0;
}

export type DrainOutboundSendsResult = {
  attempted: number;
  sent: number;
  halted: string | null;
  stuckSending: number;
};

export async function drainOutboundSends(
  db: Database,
  env: Env,
  now: Date = new Date(),
): Promise<DrainOutboundSendsResult> {
  return withOutboundDrainLock(db, () => runOutboundDrainLocked(db, env, now));
}

async function runOutboundDrainLocked(
  db: Database,
  env: Env,
  now: Date,
): Promise<DrainOutboundSendsResult> {
  const stuckSending = await stuckSendingCount(db);
  const queuedRows = await db
    .select()
    .from(outboundSends)
    .where(
      and(eq(outboundSends.status, "queued"), eq(outboundSends.isSeed, false)),
    )
    .orderBy(asc(outboundSends.createdAt))
    .limit(50);
  let blocked = 0;
  const stillQueued: typeof queuedRows = [];
  for (const row of queuedRows) {
    const prepared = await prepareQueuedSend(db, row, env.EMAIL_HASH_KEY);
    if (prepared.ready) {
      stillQueued.push(row);
    } else {
      blocked += 1;
    }
  }
  if (!env.POSTMARK_SEND_ENABLED || !env.POSTMARK_SERVER_TOKEN) {
    return { attempted: blocked, sent: 0, halted: null, stuckSending };
  }
  const complaintRate = await weekComplaintRate(db, now);
  const release = planOutboundDrainRelease(complaintRate);
  if (release.halt) {
    return { attempted: blocked, sent: 0, halted: release.reason, stuckSending };
  }
  const ticks = remainingSendTicksInWindow(now);
  if (ticks === 0) {
    return { attempted: blocked, sent: 0, halted: null, stuckSending };
  }
  const budget = sendTickBudget({
    dailyCap: dailySendCap(await warmupDayIndex(db, now)),
    alreadySentToday: await todaySentCount(db, now),
    queued: stillQueued.length,
    remainingTicksInWindow: ticks,
  });
  let sent = 0;
  let attempted = blocked;
  const seededTags = new Set<string>();
  for (const row of stillQueued.slice(0, budget)) {
    attempted += 1;
    if (row.tag && !seededTags.has(row.tag)) {
      await ensureSeeds(db, env, row);
      seededTags.add(row.tag);
    }
    if (await deliverOutboundSend(db, env, row.id)) {
      sent += 1;
    }
  }
  return { attempted, sent, halted: null, stuckSending };
}
