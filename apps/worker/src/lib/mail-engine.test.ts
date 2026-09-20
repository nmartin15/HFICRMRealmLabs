import { PARTNER_MAILBOX_EMAIL, PERSONAL_MAILBOX_EMAIL } from "@realm-labs/contracts";
import { getTableName, type Table } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyMailEngineFromSequence,
  cancelMailEngineOnReply,
  enqueueDueMailTouches,
} from "./mail-engine.js";

const KEY = "ab".repeat(32);
const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const TOUCH_ID = "33333333-3333-4333-8333-333333333333";
const ENROLLMENT_ID = "44444444-4444-4444-8444-444444444444";
const SEND_ID = "55555555-5555-4555-8555-555555555555";
const OPEN_ID = "66666666-6666-4666-8666-666666666666";
const TAG = "rl.v1.sales.allocation.applied.warm";
const NOW = new Date("2026-09-19T17:00:00.000Z");
const here = dirname(fileURLToPath(import.meta.url));

function tableName(table: unknown): string {
  return getTableName(table as Table);
}

function thenableRows(rows: unknown[]) {
  const chain = () => thenableRows(rows);
  return Object.assign(Promise.resolve(rows), {
    where: chain,
    orderBy: chain,
    limit: async () => rows,
  });
}

function contactPerson(input?: {
  contactKind?: "contact" | "recruiter";
  ownerId?: string | null;
  deletedAt?: Date | null;
}) {
  return {
    id: PERSON_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    deletedAt: input?.deletedAt ?? null,
    contactKind: input?.contactKind ?? "contact",
    ownerId: input?.ownerId === undefined ? OWNER_ID : input.ownerId,
    doNotContact: false,
    emailVerificationResult: null,
  };
}

function scheduledTouch(input?: { touchIndex?: 0 | 1 }) {
  return {
    id: TOUCH_ID,
    personId: PERSON_ID,
    enrollmentId: ENROLLMENT_ID,
    tag: TAG,
    touchIndex: input?.touchIndex ?? 0,
    dueAt: NOW,
    status: "scheduled" as const,
    outboundSendId: null,
    enrolledAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function filledTemplate() {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    lane: "sales" as const,
    program: "allocation",
    stage: "applied",
    purpose: "sales" as const,
    subject: "Hi {{firstName}}",
    bodyText: "Hello {{name}} — {{program}} {{stage}}",
  };
}

function enqueueDb(input: {
  person: ReturnType<typeof contactPerson>;
  template: ReturnType<typeof filledTemplate> | null;
  ownerEmail?: string;
  touches?: ReturnType<typeof scheduledTouch>[];
  suppressionReason?: string | null;
}) {
  const ops: string[] = [];
  const insertedSends: Record<string, unknown>[] = [];
  const touches = input.touches ?? [scheduledTouch()];
  return {
    ops,
    insertedSends,
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        if (name === "outbound_sends") {
          return thenableRows([{ n: 0 }]);
        }
        if (name === "person_mail_enrollments") {
          return thenableRows(touches);
        }
        if (name === "people") {
          return thenableRows([input.person]);
        }
        if (name === "mail_templates") {
          return thenableRows(input.template ? [input.template] : []);
        }
        if (name === "users") {
          return thenableRows(
            input.ownerEmail ? [{ email: input.ownerEmail }] : [],
          );
        }
        if (name === "person_consents") {
          return thenableRows([]);
        }
        if (name === "email_suppressions") {
          return thenableRows(
            input.suppressionReason
              ? [{ reason: input.suppressionReason }]
              : [],
          );
        }
        return thenableRows([]);
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const name = tableName(table);
        ops.push(`insert:${name}`);
        if (name === "outbound_sends") {
          insertedSends.push(values);
          return Object.assign(Promise.resolve([{ id: SEND_ID }]), {
            returning: async () => [{ id: SEND_ID }],
          });
        }
        return Object.assign(Promise.resolve([]), {
          returning: async () => [{ id: "act-1" }],
        });
      },
    }),
    update: (table: unknown) => ({
      set: (values: { status?: string }) => ({
        where: () => {
          const name = tableName(table);
          ops.push(`update:${name}:${values.status ?? "unknown"}`);
          const rows =
            values.status === "queued" ? [{ id: TOUCH_ID }] : [{ id: TOUCH_ID }];
          return Object.assign(Promise.resolve(rows), {
            returning: async () => rows,
          });
        },
      }),
    }),
  };
}

function sequenceDb(input: {
  open?: { id: string; outboundSendId: string | null; enrolledAt: Date }[];
}) {
  const open = input.open ?? [];
  const inserts: { table: string; values: unknown }[] = [];
  const updates: { table: string; status: string }[] = [];
  return {
    inserts,
    updates,
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        const rows = name === "person_mail_enrollments" ? open : [];
        return thenableRows(rows);
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table: tableName(table), values });
        return Promise.resolve([]);
      },
    }),
    update: (table: unknown) => ({
      set: (values: { status?: string }) => ({
        where: async () => {
          updates.push({
            table: tableName(table),
            status: values.status ?? "unknown",
          });
        },
      }),
    }),
  };
}

describe("enqueueDueMailTouches", () => {
  it("skips recruiter people and leftover touches", async () => {
    const db = enqueueDb({
      person: contactPerson({ contactKind: "recruiter" }),
      template: filledTemplate(),
      ownerEmail: PERSONAL_MAILBOX_EMAIL,
    });
    const enqueued = await enqueueDueMailTouches(db as never, { EMAIL_HASH_KEY: KEY }, {
      now: NOW,
      dailyCap: 25,
      alreadySentToday: 0,
      remainingTicksInWindow: 4,
    });
    expect(enqueued).toBe(0);
    expect(db.insertedSends).toEqual([]);
    expect(db.ops.filter((op) => op.startsWith("update:person_mail_enrollments"))).toEqual([
      "update:person_mail_enrollments:skipped",
      "update:person_mail_enrollments:skipped",
    ]);
  });

  it("skips empty templates and leftover first-touch follow-ups", async () => {
    const db = enqueueDb({
      person: contactPerson(),
      template: null,
      ownerEmail: PERSONAL_MAILBOX_EMAIL,
    });
    const enqueued = await enqueueDueMailTouches(db as never, { EMAIL_HASH_KEY: KEY }, {
      now: NOW,
      dailyCap: 25,
      alreadySentToday: 0,
      remainingTicksInWindow: 4,
    });
    expect(enqueued).toBe(0);
    expect(db.insertedSends).toEqual([]);
    expect(db.ops).toContain("update:person_mail_enrollments:skipped");
    expect(db.ops).toContain("insert:activities");
  });

  it("does not skip remaining touches when a bump template is blank", async () => {
    const db = enqueueDb({
      person: contactPerson(),
      template: null,
      ownerEmail: PERSONAL_MAILBOX_EMAIL,
      touches: [scheduledTouch({ touchIndex: 1 })],
    });
    const enqueued = await enqueueDueMailTouches(db as never, { EMAIL_HASH_KEY: KEY }, {
      now: NOW,
      dailyCap: 25,
      alreadySentToday: 0,
      remainingTicksInWindow: 4,
    });
    expect(enqueued).toBe(0);
    expect(
      db.ops.filter((op) => op === "update:person_mail_enrollments:skipped"),
    ).toHaveLength(1);
  });

  it("enqueues merged copy with the owner Reply-To", async () => {
    const db = enqueueDb({
      person: contactPerson(),
      template: filledTemplate(),
      ownerEmail: PERSONAL_MAILBOX_EMAIL,
    });
    const enqueued = await enqueueDueMailTouches(db as never, { EMAIL_HASH_KEY: KEY }, {
      now: NOW,
      dailyCap: 25,
      alreadySentToday: 0,
      remainingTicksInWindow: 4,
    });
    expect(enqueued).toBe(1);
    expect(db.insertedSends[0]).toMatchObject({
      personId: PERSON_ID,
      toEmail: "ada@example.com",
      purpose: "sales",
      subject: "Hi Ada",
      bodyText: "Hello Ada Lovelace — allocation applied",
      tag: TAG,
      replyTo: PERSONAL_MAILBOX_EMAIL,
    });
    expect(db.ops).toContain("update:person_mail_enrollments:queued");
    expect(db.ops).toContain("insert:activities");
  });

  it("defaults Reply-To to Stefano when the contact has no owner", async () => {
    const db = enqueueDb({
      person: contactPerson({ ownerId: null }),
      template: filledTemplate(),
    });
    const enqueued = await enqueueDueMailTouches(db as never, { EMAIL_HASH_KEY: KEY }, {
      now: NOW,
      dailyCap: 25,
      alreadySentToday: 0,
      remainingTicksInWindow: 4,
    });
    expect(enqueued).toBe(1);
    expect(db.insertedSends[0]?.replyTo).toBe(PARTNER_MAILBOX_EMAIL);
  });

  it("skips suppressed addresses without enqueue", async () => {
    const db = enqueueDb({
      person: contactPerson(),
      template: filledTemplate(),
      ownerEmail: PERSONAL_MAILBOX_EMAIL,
      suppressionReason: "unsubscribed",
    });
    const enqueued = await enqueueDueMailTouches(db as never, { EMAIL_HASH_KEY: KEY }, {
      now: NOW,
      dailyCap: 25,
      alreadySentToday: 0,
      remainingTicksInWindow: 4,
    });
    expect(enqueued).toBe(0);
    expect(db.insertedSends).toEqual([]);
    expect(db.ops).toContain("update:person_mail_enrollments:skipped");
  });

  it("enqueues nothing outside the send window", async () => {
    const db = enqueueDb({
      person: contactPerson(),
      template: filledTemplate(),
      ownerEmail: PERSONAL_MAILBOX_EMAIL,
    });
    const enqueued = await enqueueDueMailTouches(db as never, { EMAIL_HASH_KEY: KEY }, {
      now: NOW,
      dailyCap: 25,
      alreadySentToday: 0,
      remainingTicksInWindow: 0,
    });
    expect(enqueued).toBe(0);
    expect(db.insertedSends).toEqual([]);
    expect(db.ops).toEqual([]);
  });
});

describe("applyMailEngineFromSequence", () => {
  it("does not write on hold or pending_review", async () => {
    const db = sequenceDb({});
    await applyMailEngineFromSequence(db as never, {
      personId: PERSON_ID,
      tag: TAG,
      sequenceAction: "hold",
      asOf: NOW,
    });
    await applyMailEngineFromSequence(db as never, {
      personId: PERSON_ID,
      tag: TAG,
      sequenceAction: "pending_review",
      asOf: NOW,
    });
    expect(db.inserts).toEqual([]);
    expect(db.updates).toEqual([]);
  });

  it("enrolls two warm sales touches on start", async () => {
    const db = sequenceDb({});
    await applyMailEngineFromSequence(db as never, {
      personId: PERSON_ID,
      tag: TAG,
      sequenceAction: "start",
      asOf: NOW,
    });
    const enrollment = db.inserts.find(
      (row) => row.table === "person_mail_enrollments",
    );
    expect(Array.isArray(enrollment?.values)).toBe(true);
    const touches = enrollment?.values as {
      touchIndex: number;
      dueAt: Date;
      status: string;
    }[];
    expect(touches).toHaveLength(2);
    expect(touches.map((touch) => touch.touchIndex)).toEqual([0, 1]);
    expect(touches[0]?.dueAt).toEqual(NOW);
    expect(touches[0]?.status).toBe("scheduled");
    expect(db.inserts.some((row) => row.table === "activities")).toBe(true);
  });

  it("cancels open touches on stop", async () => {
    const db = sequenceDb({
      open: [
        { id: OPEN_ID, outboundSendId: SEND_ID, enrolledAt: NOW },
      ],
    });
    await applyMailEngineFromSequence(db as never, {
      personId: PERSON_ID,
      tag: TAG,
      sequenceAction: "stop",
      asOf: NOW,
    });
    expect(db.updates).toEqual([
      { table: "person_mail_enrollments", status: "canceled" },
      { table: "outbound_sends", status: "blocked" },
    ]);
    expect(db.inserts.some((row) => row.table === "activities")).toBe(true);
  });
});

describe("cancelMailEngineOnReply", () => {
  it("cancels leftover touches when the reply is after enroll", async () => {
    const db = sequenceDb({
      open: [{ id: OPEN_ID, outboundSendId: null, enrolledAt: NOW }],
    });
    await cancelMailEngineOnReply(db as never, {
      personId: PERSON_ID,
      replyAt: new Date(NOW.getTime() + 1),
    });
    expect(db.updates).toEqual([
      { table: "person_mail_enrollments", status: "canceled" },
    ]);
  });

  it("leaves scheduled touches when the reply is before enroll", async () => {
    const db = sequenceDb({
      open: [{ id: OPEN_ID, outboundSendId: null, enrolledAt: NOW }],
    });
    await cancelMailEngineOnReply(db as never, {
      personId: PERSON_ID,
      replyAt: new Date(NOW.getTime() - 1),
    });
    expect(db.updates).toEqual([]);
    expect(db.inserts).toEqual([]);
  });
});

describe("mail engine wiring", () => {
  it("ticks enrollments into the send pipe before the drain re-scans queued rows", () => {
    const deliverSource = readFileSync(join(here, "deliver.ts"), "utf8");
    const enqueueAt = deliverSource.indexOf("enqueueDueMailTouches");
    const queuedAfterAt = deliverSource.indexOf("queuedAfter");
    expect(enqueueAt).toBeGreaterThan(-1);
    expect(queuedAfterAt).toBeGreaterThan(enqueueAt);
  });

  it("sends Reply-To as a Postmark header, not From", () => {
    const postmarkSource = readFileSync(join(here, "postmark.ts"), "utf8");
    expect(postmarkSource).toContain('Name: "Reply-To"');
    expect(postmarkSource).not.toContain("ReplyTo:");
  });

  it("cancels leftover touches after an inbound applicant reply", () => {
    const syncSource = readFileSync(join(here, "../jobs/sync.ts"), "utf8");
    const replyAt = syncSource.indexOf("isInboundReply");
    const cancelAt = syncSource.indexOf("cancelMailEngineOnReply");
    expect(replyAt).toBeGreaterThan(-1);
    expect(cancelAt).toBeGreaterThan(replyAt);
  });

  it("enrolls when a campaign tag starts", () => {
    const tagSource = readFileSync(join(here, "campaign-tag.ts"), "utf8");
    expect(tagSource).toContain("applyMailEngineFromSequence");
  });
});
