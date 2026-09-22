import {
  canonicalEmail,
  hasStayInTouch,
  isBlankMailTemplate,
  kickboxBlocksSend,
  mergeMailTemplate,
  parseCampaignTag,
  parseKickboxResult,
  planCampaignReplyTo,
  planMailTickEnqueueCount,
  planOutboundSend,
} from "@realm-labs/contracts";
import {
  emailSuppressions,
  hmacSha256Hex,
  listDueMailTouches,
  mailTemplates,
  markMailTouchQueued,
  markMailTouchSkipped,
  outboundSends,
  people,
  personConsents,
  personMailEnrollments,
  skipRemainingEnrollmentTouches,
  users,
  type Database,
} from "@realm-labs/db";
import { and, eq, sql } from "drizzle-orm";
import { writeActivity } from "./activity.js";
import type { Env } from "../env.js";

export { applyMailEngineFromSequence, cancelMailEngineOnReply } from "@realm-labs/db";

function outboundEmailHash(emailHashKey: string, email: string): string {
  return hmacSha256Hex(emailHashKey, canonicalEmail(email));
}

async function queuedNonSeedCount(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outboundSends)
    .where(
      and(eq(outboundSends.status, "queued"), eq(outboundSends.isSeed, false)),
    );
  return row?.n ?? 0;
}

async function loadTemplate(
  db: Database,
  lane: "sales" | "newsletter",
  program: string,
  stage: string,
) {
  const rows = await db
    .select()
    .from(mailTemplates)
    .where(
      and(
        eq(mailTemplates.lane, lane),
        eq(mailTemplates.program, program),
        eq(mailTemplates.stage, stage),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function enqueueDueMailTouches(
  db: Database,
  env: Pick<Env, "EMAIL_HASH_KEY">,
  input: {
    now: Date;
    dailyCap: number;
    alreadySentToday: number;
    remainingTicksInWindow: number;
  },
): Promise<number> {
  const alreadyQueued = await queuedNonSeedCount(db);
  const duePreview = await listDueMailTouches(db, input.now, 200);
  const limit = planMailTickEnqueueCount({
    dueCount: duePreview.length,
    alreadyQueued,
    dailyCap: input.dailyCap,
    alreadySentToday: input.alreadySentToday,
    remainingTicksInWindow: input.remainingTicksInWindow,
  });
  if (limit <= 0) {
    return 0;
  }
  const due = duePreview.slice(0, limit);
  let enqueued = 0;
  for (const touch of due) {
    try {
      if (await enqueueOneTouch(db, env, touch)) {
        enqueued += 1;
      }
    } catch {
      await markMailTouchSkipped(db, touch.id).catch(() => undefined);
    }
  }
  return enqueued;
}

async function enqueueOneTouch(
  db: Database,
  env: Pick<Env, "EMAIL_HASH_KEY">,
  touch: typeof personMailEnrollments.$inferSelect,
): Promise<boolean> {
  const parsed = parseCampaignTag(touch.tag);
  if (!parsed) {
    await markMailTouchSkipped(db, touch.id);
    return false;
  }
  const personRows = await db
    .select()
    .from(people)
    .where(eq(people.id, touch.personId))
    .limit(1);
  const person = personRows[0];
  if (!person || person.deletedAt || person.contactKind === "recruiter") {
    await markMailTouchSkipped(db, touch.id);
    await skipRemainingEnrollmentTouches(db, touch.enrollmentId);
    return false;
  }
  const template = await loadTemplate(
    db,
    parsed.lane,
    parsed.program,
    parsed.stage,
  );
  if (!template || isBlankMailTemplate(template.subject, template.bodyText)) {
    await markMailTouchSkipped(db, touch.id);
    if (touch.touchIndex === 0) {
      await skipRemainingEnrollmentTouches(db, touch.enrollmentId);
    }
    await writeActivity(db, {
      personId: person.id,
      userId: null,
      type: "field_change",
      payload: {
        who: { id: "system", email: "mail.engine" },
        what: "mail.skip",
        when: new Date().toISOString(),
        before: { touchIndex: touch.touchIndex, tag: touch.tag },
        after: { reason: "blank_template" },
      },
    });
    return false;
  }
  const ownerRows = person.ownerId
    ? await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, person.ownerId))
        .limit(1)
    : [];
  const replyTo = planCampaignReplyTo(ownerRows[0]?.email ?? null);
  const consentRows = await db
    .select({
      channel: personConsents.channel,
      status: personConsents.status,
    })
    .from(personConsents)
    .where(eq(personConsents.personId, person.id));
  const hash = outboundEmailHash(env.EMAIL_HASH_KEY, person.email);
  const suppressionRows = await db
    .select({ reason: emailSuppressions.reason })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.emailHash, hash))
    .limit(1);
  const plan = planOutboundSend({
    suppressionReason: suppressionRows[0]?.reason ?? null,
    purpose: template.purpose,
    stayInTouch: hasStayInTouch(consentRows),
    doNotContact: person.doNotContact,
    stayInTouchOptedOut: person.stayInTouchOptedOut,
    emailUndeliverable: kickboxBlocksSend(
      parseKickboxResult(person.emailVerificationResult),
    ),
    isSeed: false,
    contactKind: person.contactKind,
  });
  if (!plan.ok) {
    await markMailTouchSkipped(db, touch.id);
    await skipRemainingEnrollmentTouches(db, touch.enrollmentId);
    await writeActivity(db, {
      personId: person.id,
      userId: null,
      type: "field_change",
      payload: {
        who: { id: "system", email: "mail.engine" },
        what: "mail.skip",
        when: new Date().toISOString(),
        before: { touchIndex: touch.touchIndex, tag: touch.tag },
        after: { reason: plan.code },
      },
    });
    return false;
  }
  const fields = {
    name: `${person.firstName} ${person.lastName}`.trim(),
    firstName: person.firstName,
    program: parsed.program,
    stage: parsed.stage,
  };
  const inserted = await db
    .insert(outboundSends)
    .values({
      personId: person.id,
      emailHash: hash,
      toEmail: canonicalEmail(person.email),
      purpose: template.purpose,
      subject: mergeMailTemplate(template.subject, fields),
      bodyText: mergeMailTemplate(template.bodyText, fields),
      tag: touch.tag,
      replyTo,
    })
    .returning({ id: outboundSends.id });
  const sendId = inserted[0]?.id;
  if (!sendId) {
    return false;
  }
  const marked = await markMailTouchQueued(db, {
    id: touch.id,
    outboundSendId: sendId,
  });
  if (!marked) {
    return false;
  }
  await writeActivity(db, {
    personId: person.id,
    userId: null,
    type: "field_change",
    payload: {
      who: { id: "system", email: "mail.engine" },
      what: "mail.enqueue",
      when: new Date().toISOString(),
      before: { touchIndex: touch.touchIndex },
      after: { outboundSendId: sendId, replyTo },
    },
  });
  return true;
}
