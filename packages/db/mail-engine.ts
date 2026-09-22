import {
  parseCampaignTag,
  planEnrollmentTouches,
  planMailEngineAction,
  planMailReplyCancel,
  planStayInTouchNextDue,
  shouldScheduleStayInTouchRenewal,
  type CampaignSequenceAction,
} from "@realm-labs/contracts";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Database } from "./client";
import { activities, outboundSends, people, personMailEnrollments } from "./schema";

const OPEN_ENROLLMENT_STATUSES = ["scheduled", "queued"] as const;

export async function cancelOpenMailEnrollments(
  db: Database,
  personId: string,
): Promise<{
  canceled: number;
  blockedSendIds: string[];
}> {
  const open = await db
    .select({
      id: personMailEnrollments.id,
      outboundSendId: personMailEnrollments.outboundSendId,
    })
    .from(personMailEnrollments)
    .where(
      and(
        eq(personMailEnrollments.personId, personId),
        inArray(personMailEnrollments.status, [...OPEN_ENROLLMENT_STATUSES]),
      ),
    );
  if (open.length === 0) {
    return { canceled: 0, blockedSendIds: [] };
  }
  const sendIds = open
    .map((row) => row.outboundSendId)
    .filter((id): id is string => Boolean(id));
  await db
    .update(personMailEnrollments)
    .set({ status: "canceled" })
    .where(
      inArray(
        personMailEnrollments.id,
        open.map((row) => row.id),
      ),
    );
  if (sendIds.length > 0) {
    await db
      .update(outboundSends)
      .set({ status: "blocked" })
      .where(
        and(
          inArray(outboundSends.id, sendIds),
          inArray(outboundSends.status, ["queued", "sending"]),
        ),
      );
  }
  return { canceled: open.length, blockedSendIds: sendIds };
}

export async function insertMailEnrollmentTouches(
  db: Database,
  input: {
    personId: string;
    enrollmentId: string;
    tag: string;
    enrolledAt: Date;
    touches: { touchIndex: 0 | 1; dueAt: Date }[];
  },
): Promise<void> {
  if (input.touches.length === 0) {
    return;
  }
  await db.insert(personMailEnrollments).values(
    input.touches.map((touch) => ({
      personId: input.personId,
      enrollmentId: input.enrollmentId,
      tag: input.tag,
      touchIndex: touch.touchIndex,
      dueAt: touch.dueAt,
      status: "scheduled" as const,
      enrolledAt: input.enrolledAt,
    })),
  );
}

export async function listDueMailTouches(
  db: Database,
  now: Date,
  limit: number,
) {
  if (limit <= 0) {
    return [];
  }
  return db
    .select()
    .from(personMailEnrollments)
    .where(
      and(
        eq(personMailEnrollments.status, "scheduled"),
        lte(personMailEnrollments.dueAt, now),
      ),
    )
    .orderBy(asc(personMailEnrollments.dueAt), asc(personMailEnrollments.createdAt))
    .limit(limit);
}

export async function markMailTouchQueued(
  db: Database,
  input: { id: string; outboundSendId: string },
): Promise<boolean> {
  const [row] = await db
    .update(personMailEnrollments)
    .set({
      status: "queued",
      outboundSendId: input.outboundSendId,
    })
    .where(
      and(
        eq(personMailEnrollments.id, input.id),
        eq(personMailEnrollments.status, "scheduled"),
      ),
    )
    .returning({ id: personMailEnrollments.id });
  return Boolean(row);
}

export async function markMailTouchSkipped(
  db: Database,
  id: string,
): Promise<void> {
  await db
    .update(personMailEnrollments)
    .set({ status: "skipped" })
    .where(
      and(
        eq(personMailEnrollments.id, id),
        eq(personMailEnrollments.status, "scheduled"),
      ),
    );
}

export async function skipRemainingEnrollmentTouches(
  db: Database,
  enrollmentId: string,
): Promise<void> {
  await db
    .update(personMailEnrollments)
    .set({ status: "skipped" })
    .where(
      and(
        eq(personMailEnrollments.enrollmentId, enrollmentId),
        eq(personMailEnrollments.status, "scheduled"),
      ),
    );
}

export async function latestOpenMailEnrollment(
  db: Database,
  personId: string,
) {
  const rows = await db
    .select()
    .from(personMailEnrollments)
    .where(eq(personMailEnrollments.personId, personId))
    .orderBy(asc(personMailEnrollments.touchIndex));
  const open = rows.find(
    (row) => row.status === "scheduled" || row.status === "queued",
  );
  return open ?? rows[rows.length - 1] ?? null;
}

async function writeMailActivity(
  db: Database,
  input: {
    personId: string;
    what: string;
    when: Date;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  },
): Promise<void> {
  await db.insert(activities).values({
    personId: input.personId,
    userId: null,
    type: "field_change",
    payload: {
      who: { id: "system", email: "mail.engine" },
      what: input.what,
      when: input.when.toISOString(),
      before: input.before,
      after: input.after,
    },
    occurredAt: input.when,
  });
}

export async function persistStayInTouchOptOut(
  db: Database,
  input: { personId: string; when: Date },
): Promise<boolean> {
  const [updated] = await db
    .update(people)
    .set({ stayInTouchOptedOut: true })
    .where(eq(people.id, input.personId))
    .returning({ id: people.id });
  if (!updated) {
    return false;
  }
  const canceled = await cancelOpenMailEnrollments(db, input.personId);
  await writeMailActivity(db, {
    personId: input.personId,
    what: "mail.stay_in_touch_opt_out",
    when: input.when,
    before: { stayInTouchOptedOut: false },
    after: { stayInTouchOptedOut: true, canceled: canceled.canceled },
  });
  return true;
}

export async function scheduleStayInTouchRenewal(
  db: Database,
  input: {
    personId: string;
    tag: string;
    purpose: "sales" | "newsletter" | "value_add";
    sentAt: Date;
    optedOut: boolean;
  },
): Promise<boolean> {
  const parsed = parseCampaignTag(input.tag);
  const open = await db
    .select({ id: personMailEnrollments.id })
    .from(personMailEnrollments)
    .where(
      and(
        eq(personMailEnrollments.personId, input.personId),
        inArray(personMailEnrollments.status, [...OPEN_ENROLLMENT_STATUSES]),
      ),
    )
    .limit(1);
  if (
    !shouldScheduleStayInTouchRenewal({
      purpose: input.purpose,
      lane: parsed?.lane ?? null,
      optedOut: input.optedOut,
      hasOpenTouch: Boolean(open[0]),
    })
  ) {
    return false;
  }
  const enrollmentId = randomUUID();
  const dueAt = new Date(planStayInTouchNextDue(input.sentAt.getTime()));
  await insertMailEnrollmentTouches(db, {
    personId: input.personId,
    enrollmentId,
    tag: input.tag,
    enrolledAt: input.sentAt,
    touches: [{ touchIndex: 0, dueAt }],
  });
  await writeMailActivity(db, {
    personId: input.personId,
    what: "mail.enroll",
    when: input.sentAt,
    before: null,
    after: {
      tag: input.tag,
      enrollmentId,
      touches: 1,
      reason: "stay_in_touch_renewal",
    },
  });
  return true;
}

export async function applyMailEngineFromSequence(
  db: Database,
  input: {
    personId: string;
    tag: string | null;
    sequenceAction: CampaignSequenceAction | null;
    asOf: Date;
  },
): Promise<void> {
  const action = planMailEngineAction(input.sequenceAction);
  if (action === "noop") {
    return;
  }
  if (action === "cancel" || !input.tag) {
    const canceled = await cancelOpenMailEnrollments(db, input.personId);
    if (canceled.canceled > 0) {
      await writeMailActivity(db, {
        personId: input.personId,
        what: "mail.cancel",
        when: input.asOf,
        before: { open: canceled.canceled },
        after: { tag: input.tag, action: "canceled" },
      });
    }
    return;
  }
  const parsed = parseCampaignTag(input.tag);
  if (!parsed) {
    return;
  }
  await cancelOpenMailEnrollments(db, input.personId);
  const enrollmentId = randomUUID();
  const touches = planEnrollmentTouches({
    enrolledAt: input.asOf.getTime(),
    intensity: parsed.intensity,
    lane: parsed.lane,
  });
  await insertMailEnrollmentTouches(db, {
    personId: input.personId,
    enrollmentId,
    tag: input.tag,
    enrolledAt: input.asOf,
    touches: touches.map((touch) => ({
      touchIndex: touch.touchIndex,
      dueAt: new Date(touch.dueAt),
    })),
  });
  await writeMailActivity(db, {
    personId: input.personId,
    what: "mail.enroll",
    when: input.asOf,
    before: null,
    after: {
      tag: input.tag,
      enrollmentId,
      touches: touches.length,
    },
  });
}

export async function cancelMailEngineOnReply(
  db: Database,
  input: { personId: string; replyAt: Date },
): Promise<void> {
  const open = await db
    .select({
      enrolledAt: personMailEnrollments.enrolledAt,
    })
    .from(personMailEnrollments)
    .where(
      and(
        eq(personMailEnrollments.personId, input.personId),
        inArray(personMailEnrollments.status, [...OPEN_ENROLLMENT_STATUSES]),
      ),
    )
    .limit(1);
  const enrolledAt = open[0]?.enrolledAt;
  if (!enrolledAt) {
    return;
  }
  if (
    !planMailReplyCancel({
      enrolledAt: enrolledAt.getTime(),
      replyAt: input.replyAt.getTime(),
    })
  ) {
    return;
  }
  const canceled = await cancelOpenMailEnrollments(db, input.personId);
  if (canceled.canceled > 0) {
    await writeMailActivity(db, {
      personId: input.personId,
      what: "mail.cancel",
      when: input.replyAt,
      before: { open: canceled.canceled },
      after: { reason: "inbound_reply" },
    });
  }
}
