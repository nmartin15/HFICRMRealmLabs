import {
  calendarSyncJobDataSchema,
  cancelledMeetingResolution,
  DISPLAY_TIME_ZONE,
  emailSnippet,
  gmailSyncJobDataSchema,
  isInboundReply,
  mailboxEmails,
  matchPersonFromParticipants,
  parseEmailAddresses,
  uniqueEmails,
  zonedLocalToUtc,
  type Mailbox,
} from "@realm-labs/contracts";
import {
  decryptSecret,
  emailThreads,
  mailboxConnections,
  meetings,
  people,
  users,
  type Database,
} from "@realm-labs/db";
import { and, eq, isNull } from "drizzle-orm";
import { google, type calendar_v3, type gmail_v1 } from "googleapis";
import type { Env } from "../env.js";
import { writeActivity } from "../lib/activity.js";
import { googleClientFromRefreshToken } from "../lib/google.js";
import {
  maybeMoveOnInboundReply,
  maybeMoveOnMeetingCreated,
} from "../lib/stage-moves.js";

type Actor = { id: string; email: string };
type PersonEmail = { id: string; email: string };

function headerValue(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  const needle = name.toLowerCase();
  return (
    headers?.find((header) => (header.name ?? "").toLowerCase() === needle)
      ?.value ?? ""
  );
}

function isStaleHistory(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const code = "code" in err ? Number(err.code) : Number.NaN;
  const message =
    "message" in err && typeof err.message === "string" ? err.message : "";
  return (
    code === 404 ||
    message.toLowerCase().includes("historyid") ||
    message.toLowerCase().includes("not found")
  );
}

async function loadPeople(db: Database): Promise<PersonEmail[]> {
  const rows = await db
    .select({ id: people.id, email: people.email })
    .from(people)
    .where(isNull(people.deletedAt));
  return rows;
}

async function loadActor(db: Database, userId: string): Promise<Actor> {
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("Mailbox connected_by user is missing");
  }
  return row;
}

async function markSyncError(
  db: Database,
  mailbox: Mailbox,
  message: string,
): Promise<void> {
  await db
    .update(mailboxConnections)
    .set({ lastError: message })
    .where(eq(mailboxConnections.mailbox, mailbox));
}

async function markSyncOk(
  db: Database,
  mailbox: Mailbox,
  historyId: string | null,
): Promise<void> {
  await db
    .update(mailboxConnections)
    .set({
      lastError: null,
      lastSyncedAt: new Date(),
      gmailHistoryId: historyId,
    })
    .where(eq(mailboxConnections.mailbox, mailbox));
}

async function listChangedThreadIds(
  gmail: gmail_v1.Gmail,
  startHistoryId: string,
): Promise<{ threadIds: string[]; historyId: string | null }> {
  const threadIds = new Set<string>();
  let pageToken: string | undefined;
  let historyId: string | null = null;

  do {
    const { data } = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded"],
      pageToken,
    });
    historyId = data.historyId ?? historyId;
    for (const item of data.history ?? []) {
      for (const added of item.messagesAdded ?? []) {
        const threadId = added.message?.threadId;
        if (threadId) {
          threadIds.add(threadId);
        }
      }
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  return { threadIds: [...threadIds], historyId };
}

async function listAllThreadIds(gmail: gmail_v1.Gmail): Promise<string[]> {
  const threadIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await gmail.users.threads.list({
      userId: "me",
      maxResults: 100,
      pageToken,
    });
    for (const thread of data.threads ?? []) {
      if (thread.id) {
        threadIds.push(thread.id);
      }
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return threadIds;
}

async function upsertGmailThread(
  db: Database,
  input: {
    mailbox: Mailbox;
    threadId: string;
    subject: string;
    lastMessageAt: Date;
    snippet: string;
    participantEmails: string[];
    personId: string | null;
    latestFrom: string | null;
    messageCount: number;
    inReplyTo: string | null;
    people: PersonEmail[];
    actor: Actor;
    mailboxAddresses: readonly string[];
  },
): Promise<void> {
  const existingRows = await db
    .select()
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.mailbox, input.mailbox),
        eq(emailThreads.gmailThreadId, input.threadId),
      ),
    )
    .limit(1);
  const existing = existingRows[0];
  const personId = existing?.personId ?? input.personId;
  const isNewMessage =
    !existing || existing.lastMessageAt.getTime() < input.lastMessageAt.getTime();

  if (existing) {
    await db
      .update(emailThreads)
      .set({
        personId,
        subject: input.subject,
        lastMessageAt: input.lastMessageAt,
        snippet: input.snippet,
        participantEmails: input.participantEmails,
        sharedVisible: input.mailbox === "shared",
      })
      .where(eq(emailThreads.id, existing.id));
  } else {
    await db.insert(emailThreads).values({
      personId,
      mailbox: input.mailbox,
      gmailThreadId: input.threadId,
      subject: input.subject,
      lastMessageAt: input.lastMessageAt,
      snippet: input.snippet,
      participantEmails: input.participantEmails,
      sharedVisible: input.mailbox === "shared",
    });
  }

  if (!personId || !isNewMessage) {
    return;
  }

  const person = input.people.find((row) => row.id === personId);
  if (!person) {
    return;
  }

  await writeActivity(db, {
    personId,
    userId: input.actor.id,
    type: "email",
    payload: {
      who: { id: input.actor.id, email: input.actor.email },
      what: "email.received",
      when: input.lastMessageAt.toISOString(),
      before: null,
      after: {
        mailbox: input.mailbox,
        threadId: input.threadId,
        subject: input.subject,
        snippet: input.snippet,
      },
    },
  });

  if (
    isInboundReply({
      latestFrom: input.latestFrom,
      personEmail: person.email,
      messageCount: input.messageCount,
      inReplyTo: input.inReplyTo,
      mailboxAddresses: input.mailboxAddresses,
    })
  ) {
    await maybeMoveOnInboundReply(db, {
      personId,
      actor: input.actor,
      when: input.lastMessageAt,
    });
  }
}

async function processGmailThread(
  gmail: gmail_v1.Gmail,
  db: Database,
  input: {
    mailbox: Mailbox;
    threadId: string;
    people: PersonEmail[];
    actor: Actor;
    mailboxAddresses: readonly string[];
  },
): Promise<void> {
  const { data } = await gmail.users.threads.get({
    userId: "me",
    id: input.threadId,
    format: "metadata",
    metadataHeaders: [
      "From",
      "To",
      "Cc",
      "Bcc",
      "Subject",
      "In-Reply-To",
      "References",
    ],
  });

  const messages = data.messages ?? [];
  if (messages.length === 0) {
    return;
  }

  const sorted = [...messages].sort((a, b) => {
    const aDate = Number(a.internalDate ?? 0);
    const bDate = Number(b.internalDate ?? 0);
    return aDate - bDate;
  });
  const latest = sorted[sorted.length - 1];
  if (!latest) {
    return;
  }

  const participantEmails = uniqueEmails(
    sorted.flatMap((message) => {
      const headers = message.payload?.headers ?? [];
      return [
        ...parseEmailAddresses(headerValue(headers, "From")),
        ...parseEmailAddresses(headerValue(headers, "To")),
        ...parseEmailAddresses(headerValue(headers, "Cc")),
        ...parseEmailAddresses(headerValue(headers, "Bcc")),
      ];
    }),
  );

  const latestHeaders = latest.payload?.headers ?? [];
  const latestFrom =
    parseEmailAddresses(headerValue(latestHeaders, "From"))[0] ?? null;
  const inReplyTo =
    headerValue(latestHeaders, "In-Reply-To") ||
    headerValue(latestHeaders, "References") ||
    null;
  const subject =
    headerValue(latestHeaders, "Subject") || data.snippet || "(no subject)";
  const lastMessageAt = new Date(Number(latest.internalDate ?? Date.now()));
  const snippet = emailSnippet(latest.snippet ?? data.snippet ?? "");
  const matched = matchPersonFromParticipants(
    participantEmails,
    input.people,
    input.mailboxAddresses,
  );

  await upsertGmailThread(db, {
    mailbox: input.mailbox,
    threadId: input.threadId,
    subject,
    lastMessageAt,
    snippet,
    participantEmails,
    personId: matched?.id ?? null,
    latestFrom,
    messageCount: messages.length,
    inReplyTo,
    people: input.people,
    actor: input.actor,
    mailboxAddresses: input.mailboxAddresses,
  });
}

export async function runGmailSync(
  db: Database,
  env: Env,
  rawData: unknown,
): Promise<void> {
  const { mailbox } = gmailSyncJobDataSchema.parse(rawData);
  const connectionRows = await db
    .select()
    .from(mailboxConnections)
    .where(eq(mailboxConnections.mailbox, mailbox))
    .limit(1);
  const connection = connectionRows[0];
  if (!connection) {
    return;
  }

  try {
    const refreshToken = decryptSecret(
      connection.refreshTokenEncrypted,
      env.TOKEN_ENCRYPTION_KEY,
    );
    const auth = googleClientFromRefreshToken(env, refreshToken);
    const gmail = google.gmail({ version: "v1", auth });
    const actor = await loadActor(db, connection.connectedBy);
    const personRows = await loadPeople(db);
    const addresses = mailboxEmails();

    let threadIds: string[] = [];
    let usedFullList = !connection.gmailHistoryId;

    if (connection.gmailHistoryId) {
      try {
        const changed = await listChangedThreadIds(
          gmail,
          connection.gmailHistoryId,
        );
        threadIds = changed.threadIds;
      } catch (err) {
        if (!isStaleHistory(err)) {
          throw err;
        }
        usedFullList = true;
      }
    }

    if (usedFullList) {
      threadIds = await listAllThreadIds(gmail);
    }

    for (const threadId of threadIds) {
      await processGmailThread(gmail, db, {
        mailbox,
        threadId,
        people: personRows,
        actor,
        mailboxAddresses: addresses,
      });
    }

    const profile = await gmail.users.getProfile({ userId: "me" });
    await markSyncOk(db, mailbox, profile.data.historyId ?? null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gmail sync failed";
    await markSyncError(db, mailbox, message);
    throw err;
  }
}

function eventStart(event: calendar_v3.Schema$Event): Date | null {
  const dateTime = event.start?.dateTime;
  if (dateTime) {
    const parsed = new Date(dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const date = event.start?.date;
  if (!date) {
    return null;
  }
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return zonedLocalToUtc(
    { year, month, day },
    DISPLAY_TIME_ZONE,
    9,
    0,
    0,
  );
}

function eventAttendeeEmails(event: calendar_v3.Schema$Event): string[] {
  return uniqueEmails(
    (event.attendees ?? [])
      .map((attendee) => attendee.email)
      .filter((email): email is string => Boolean(email)),
  );
}

async function listCalendarEvents(
  calendar: calendar_v3.Calendar,
  now: Date,
): Promise<calendar_v3.Schema$Event[]> {
  const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const timeMax = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const events: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await calendar.events.list({
      calendarId: "primary",
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      showDeleted: true,
      maxResults: 250,
      pageToken,
    });
    events.push(...(data.items ?? []));
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return events;
}

function replacementExists(
  events: calendar_v3.Schema$Event[],
  cancelled: calendar_v3.Schema$Event,
  person: PersonEmail,
  mailboxAddresses: readonly string[],
): boolean {
  return events.some((event) => {
    if (event.id === cancelled.id) {
      return false;
    }
    if (event.status === "cancelled") {
      return false;
    }
    const emails = eventAttendeeEmails(event);
    return Boolean(
      matchPersonFromParticipants(emails, [person], mailboxAddresses),
    );
  });
}

async function upsertCalendarMeeting(
  db: Database,
  input: {
    event: calendar_v3.Schema$Event;
    person: PersonEmail;
    scheduledAt: Date;
    cancelled: boolean;
    hasReplacement: boolean;
    actor: Actor;
  },
): Promise<void> {
  const calendarEventId = input.event.id;
  if (!calendarEventId) {
    return;
  }

  const existingRows = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.personId, input.person.id),
        eq(meetings.calendarEventId, calendarEventId),
      ),
    )
    .limit(1);
  const existing = existingRows[0];
  if (existing && existing.outcome !== "scheduled") {
    await db
      .update(meetings)
      .set({ scheduledAt: input.scheduledAt })
      .where(eq(meetings.id, existing.id));
    return;
  }

  if (input.cancelled) {
    const resolution = cancelledMeetingResolution(input.hasReplacement);
    const outcome = resolution === "rescheduled" ? "rescheduled" : "scheduled";
    const needsReview = resolution === "needs_review";
    if (existing) {
      await db
        .update(meetings)
        .set({
          scheduledAt: input.scheduledAt,
          outcome,
          needsReview,
        })
        .where(eq(meetings.id, existing.id));
      return;
    }
    await db.insert(meetings).values({
      personId: input.person.id,
      scheduledAt: input.scheduledAt,
      calendarEventId,
      outcome,
      needsReview,
      createdBy: input.actor.id,
    });
    return;
  }

  if (existing) {
    await db
      .update(meetings)
      .set({
        scheduledAt: input.scheduledAt,
        needsReview: false,
      })
      .where(eq(meetings.id, existing.id));
    return;
  }

  await db.insert(meetings).values({
    personId: input.person.id,
    scheduledAt: input.scheduledAt,
    calendarEventId,
    outcome: "scheduled",
    needsReview: false,
    createdBy: input.actor.id,
  });

  await writeActivity(db, {
    personId: input.person.id,
    userId: input.actor.id,
    type: "meeting",
    payload: {
      who: { id: input.actor.id, email: input.actor.email },
      what: "meeting.scheduled",
      when: input.scheduledAt.toISOString(),
      before: null,
      after: { calendarEventId, scheduledAt: input.scheduledAt.toISOString() },
    },
  });

  await maybeMoveOnMeetingCreated(db, {
    personId: input.person.id,
    actor: input.actor,
    when: input.scheduledAt,
  });
}

export async function runCalendarSync(
  db: Database,
  env: Env,
  rawData: unknown,
): Promise<void> {
  const { mailbox } = calendarSyncJobDataSchema.parse(rawData);
  const connectionRows = await db
    .select()
    .from(mailboxConnections)
    .where(eq(mailboxConnections.mailbox, mailbox))
    .limit(1);
  const connection = connectionRows[0];
  if (!connection) {
    return;
  }

  try {
    const refreshToken = decryptSecret(
      connection.refreshTokenEncrypted,
      env.TOKEN_ENCRYPTION_KEY,
    );
    const auth = googleClientFromRefreshToken(env, refreshToken);
    const calendar = google.calendar({ version: "v3", auth });
    const actor = await loadActor(db, connection.connectedBy);
    const personRows = await loadPeople(db);
    const addresses = mailboxEmails();
    const events = await listCalendarEvents(calendar, new Date());

    for (const event of events) {
      const scheduledAt = eventStart(event);
      if (!scheduledAt) {
        continue;
      }
      const attendeeEmails = eventAttendeeEmails(event);
      const cancelled = event.status === "cancelled";
      const matchedPeople = personRows.filter((person) =>
        Boolean(
          matchPersonFromParticipants(attendeeEmails, [person], addresses),
        ),
      );

      for (const person of matchedPeople) {
        await upsertCalendarMeeting(db, {
          event,
          person,
          scheduledAt,
          cancelled,
          hasReplacement: cancelled
            ? replacementExists(events, event, person, addresses)
            : false,
          actor,
        });
      }
    }

    await db
      .update(mailboxConnections)
      .set({ lastError: null, lastSyncedAt: new Date() })
      .where(eq(mailboxConnections.mailbox, mailbox));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar sync failed";
    await markSyncError(db, mailbox, message);
    throw err;
  }
}
