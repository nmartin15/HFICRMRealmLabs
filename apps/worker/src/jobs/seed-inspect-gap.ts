import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull } from "drizzle-orm";
import {
  PERSONAL_MAILBOX_EMAIL,
  displayScoreBucket,
  inspectScoreView,
} from "@realm-labs/contracts";
import {
  createDb,
  emailMessages,
  emailThreads,
  findPersonByEmail,
  incubatorCards,
  meetings,
  people,
  personSignals,
  users,
} from "@realm-labs/db";
import { loadEnv } from "../env.js";
import { writeActivity } from "../lib/activity.js";
import { runScore } from "../lib/score-adapter.js";

const EMAIL = "inspect.gap@example.com";
const THREAD_GMAIL_ID = "inspect-gap-thread";
const MEETING_EVENT_IDS = ["inspect-gap-meeting-1", "inspect-gap-meeting-2"] as const;
const MESSAGE_GMAIL_IDS = ["inspect-gap-msg-1", "inspect-gap-msg-2"] as const;
const FAKE_EXCERPT = "Sent from my iPhone";
const EXTRACTOR = "fixture.inspect-gap";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
config({ path: resolve(root, ".env"), override: true });

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL);

try {
  const adminRows = await db
    .select()
    .from(users)
    .where(eq(users.role, "admin"));
  const admin =
    adminRows.find((row) => row.email === "nathan@realmlabs.co") ?? adminRows[0];
  if (!admin) {
    throw new Error("No admin user to attribute the inspect-gap fixture");
  }

  const asOf = new Date();
  const when = asOf.toISOString();
  let person = await findPersonByEmail(db, EMAIL);
  if (!person) {
    const inserted = await db
      .insert(people)
      .values({
        firstName: "Inspect",
        lastName: "Gap",
        email: EMAIL,
        title: "Display vs campaign fixture",
        company: "Realm Labs",
        source: "other",
        programTrack: "incubator",
        programInterest: "hedge_fund_incubator",
        budgetQualified: "heavy",
        notes:
          "Constructed to sit at 79: display hot, campaign warm. Invalidate the iPhone objection.",
        ownerId: admin.id,
      })
      .returning();
    const created = inserted[0];
    if (!created) {
      throw new Error("Failed to insert inspect-gap person");
    }
    person = created;
    await writeActivity(db, {
      personId: person.id,
      userId: admin.id,
      type: "field_change",
      payload: {
        who: { id: admin.id, email: admin.email },
        what: "inspect.gap_seed",
        when,
        before: null,
        after: { email: EMAIL, purpose: "display_vs_campaign" },
      },
    });
  } else {
    await db
      .update(people)
      .set({
        programTrack: "incubator",
        programInterest: "hedge_fund_incubator",
        budgetQualified: "heavy",
        doNotContact: false,
      })
      .where(eq(people.id, person.id));
  }

  const incubator = await db
    .select({ id: incubatorCards.id })
    .from(incubatorCards)
    .where(eq(incubatorCards.personId, person.id))
    .limit(1);
  if (!incubator[0]) {
    await db.insert(incubatorCards).values({
      personId: person.id,
      stage: "applied",
      routedAt: asOf,
    });
  } else {
    await db
      .update(incubatorCards)
      .set({ stage: "applied" })
      .where(eq(incubatorCards.personId, person.id));
  }

  for (const calendarEventId of MEETING_EVENT_IDS) {
    const existing = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(
        and(
          eq(meetings.personId, person.id),
          eq(meetings.calendarEventId, calendarEventId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await db
        .update(meetings)
        .set({
          outcome: "held",
          scheduledAt: asOf,
          attendeeAccepted: true,
        })
        .where(eq(meetings.id, existing[0].id));
      continue;
    }
    await db.insert(meetings).values({
      personId: person.id,
      scheduledAt: asOf,
      calendarEventId,
      outcome: "held",
      attendeeAccepted: true,
      createdBy: admin.id,
    });
  }

  const existingThread = await db
    .select()
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.mailbox, "personal"),
        eq(emailThreads.gmailThreadId, THREAD_GMAIL_ID),
      ),
    )
    .limit(1);
  let threadId = existingThread[0]?.id;
  if (!threadId) {
    const insertedThread = await db
      .insert(emailThreads)
      .values({
        personId: person.id,
        mailbox: "personal",
        gmailThreadId: THREAD_GMAIL_ID,
        subject: "Inspect gap replies",
        lastMessageAt: asOf,
        snippet: "Two inbound replies for the 79 fixture.",
        participantEmails: [EMAIL, PERSONAL_MAILBOX_EMAIL],
        sharedVisible: true,
      })
      .returning({ id: emailThreads.id });
    threadId = insertedThread[0]?.id;
  } else {
    await db
      .update(emailThreads)
      .set({ personId: person.id, lastMessageAt: asOf })
      .where(eq(emailThreads.id, threadId));
  }
  if (!threadId) {
    throw new Error("Failed to insert inspect-gap thread");
  }

  for (const gmailMessageId of MESSAGE_GMAIL_IDS) {
    const existingMessage = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.threadId, threadId),
          eq(emailMessages.gmailMessageId, gmailMessageId),
        ),
      )
      .limit(1);
    if (existingMessage[0]) {
      continue;
    }
    await db.insert(emailMessages).values({
      threadId,
      gmailMessageId,
      fromEmail: EMAIL,
      toEmails: [PERSONAL_MAILBOX_EMAIL],
      ccEmails: [],
      sentAt: asOf,
      bodyText: "Thanks for the follow-up.",
      snippet: "Thanks for the follow-up.",
    });
  }

  const fitRows = await db
    .select({ id: personSignals.id })
    .from(personSignals)
    .where(
      and(
        eq(personSignals.personId, person.id),
        eq(personSignals.kind, "program_fit"),
        isNull(personSignals.invalidatedAt),
      ),
    )
    .limit(1);
  if (!fitRows[0]) {
    await db.insert(personSignals).values({
      personId: person.id,
      kind: "program_fit",
      value: { fit: "no", program: "hedge_fund_incubator" },
      excerpt: "Not a fit for the incubator this year.",
      sourceType: "import",
      extractor: EXTRACTOR,
    });
  }

  const fakeRows = await db
    .select({ id: personSignals.id, excerpt: personSignals.excerpt })
    .from(personSignals)
    .where(
      and(
        eq(personSignals.personId, person.id),
        eq(personSignals.kind, "objection"),
        isNull(personSignals.invalidatedAt),
      ),
    )
    .limit(1);
  let fakeId = fakeRows[0]?.id;
  if (!fakeId) {
    const insertedFake = await db
      .insert(personSignals)
      .values({
        personId: person.id,
        kind: "objection",
        value: { topic: "other", disqualifier: false },
        excerpt: FAKE_EXCERPT,
        sourceType: "import",
        extractor: EXTRACTOR,
      })
      .returning({ id: personSignals.id });
    fakeId = insertedFake[0]?.id;
  }
  if (!fakeId) {
    throw new Error("Failed to insert fake objection signal");
  }

  const scored = await runScore(db, env, {
    personId: person.id,
    asOf,
    trigger: "import",
    mode: "commit",
    computedBy: admin.id,
  });
  if (scored.skipped || !scored.breakdown) {
    throw new Error("Inspect-gap score was skipped");
  }

  const view = inspectScoreView(
    scored.breakdown.score,
    scored.breakdown.bucket,
  );
  if (
    view.score !== 79 ||
    view.displayBucket !== "hot" ||
    view.campaignBucket !== "warm" ||
    !view.explanation
  ) {
    throw new Error(
      `Inspect-gap did not land in the 79 gap: score=${view.score} display=${view.displayBucket} campaign=${view.campaignBucket}`,
    );
  }

  const origin = env.WEB_ORIGIN.replace(/\/$/, "");
  console.log(
    JSON.stringify(
      {
        personId: person.id,
        email: EMAIL,
        url: `${origin}/people/${person.id}`,
        score: view.score,
        displayBucket: displayScoreBucket(view.score),
        campaignBucket: view.campaignBucket,
        explanation: view.explanation,
        invalidateSignalId: fakeId,
        invalidateExcerpt: FAKE_EXCERPT,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end({ timeout: 5 });
}
