import {
  alternateEmailToRecord,
  calendarEventAttendeeAccepted,
  calendarSyncJobDataSchema,
  cancelledMeetingResolution,
  DISPLAY_TIME_ZONE,
  emailSnippet,
  extractGmailPlainText,
  gmailContactSearchQueries,
  gmailHistoryChangedThreadIds,
  gmailHistoryIdToPersist,
  GMAIL_METADATA_HEADERS,
  gmailSyncJobDataSchema,
  gmailSyncPlan,
  gmailSyncShouldPersistHistoryId,
  gmailThreadIdsToSkip,
  emailMessageDirection,
  isInboundReply,
  isConfiguredMailbox,
  mailboxEmails,
  matchPersonFromParticipants,
  parseEmailAddresses,
  planCalendarMeetingTask,
  shouldProcessGmailThreadId,
  uniqueEmails,
  zonedLocalToUtc,
  type Mailbox,
  type ScoreTrigger,
} from "@realm-labs/contracts";
import {
  decryptSecret,
  emailMessages,
  emailThreads,
  listAlternateEmailsByPerson,
  mailboxConnections,
  meetings,
  people,
  personEmails,
  tasks,
  users,
  type Database,
} from "@realm-labs/db";
import { and, eq, isNull } from "drizzle-orm";
import { google, type calendar_v3, type gmail_v1 } from "googleapis";
import type { Env } from "../env.js";
import { writeActivity } from "../lib/activity.js";
import { ingestExtractedText } from "../lib/signals.js";
import {
  GmailQuotaPausedError,
  callGmail,
  createGmailQuotaBudget,
  isMissingGmailEntity,
  type GmailQuotaBudget,
} from "../lib/gmail-rate-limit.js";
import { googleClientFromRefreshToken } from "../lib/google.js";
import {
  maybeMoveOnInboundReply,
  maybeMoveOnMeetingCreated,
} from "../lib/stage-moves.js";

type Actor = { id: string; email: string };
type PersonEmail = { id: string; email: string; emails: string[] };

const CALENDAR_SYNC_LOOKBACK_MS = 400 * 24 * 60 * 60 * 1000;

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
  return isMissingGmailEntity(err);
}

async function loadPeople(db: Database): Promise<PersonEmail[]> {
  const rows = await db
    .select({ id: people.id, email: people.email })
    .from(people)
    .where(isNull(people.deletedAt));
  const alts = await listAlternateEmailsByPerson(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    emails: uniqueEmails([row.email, ...(alts.get(row.id) ?? [])]),
  }));
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
  historyId?: string | null,
): Promise<void> {
  await db
    .update(mailboxConnections)
    .set({
      lastError: message,
      ...(historyId !== undefined ? { gmailHistoryId: historyId } : {}),
    })
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

async function storedGmailThreads(
  db: Database,
  mailbox: Mailbox,
): Promise<
  { gmailThreadId: string; personId: string | null; hasMessage: boolean }[]
> {
  const rows = await db
    .select({
      gmailThreadId: emailThreads.gmailThreadId,
      personId: emailThreads.personId,
      messageId: emailMessages.id,
    })
    .from(emailThreads)
    .leftJoin(emailMessages, eq(emailMessages.threadId, emailThreads.id))
    .where(eq(emailThreads.mailbox, mailbox));

  const hasMessage = new Set<string>();
  const personByThread = new Map<string, string | null>();
  for (const row of rows) {
    personByThread.set(row.gmailThreadId, row.personId);
    if (row.messageId) {
      hasMessage.add(row.gmailThreadId);
    }
  }

  return [...personByThread.entries()].map(([gmailThreadId, personId]) => ({
    gmailThreadId,
    personId,
    hasMessage: hasMessage.has(gmailThreadId),
  }));
}

async function listChangedThreadIds(
  gmail: gmail_v1.Gmail,
  startHistoryId: string,
  budget: GmailQuotaBudget,
): Promise<{ threadIds: string[]; historyId: string | null }> {
  const threadIds = new Set<string>();
  let pageToken: string | undefined;
  let historyId: string | null = null;

  do {
    const data = await callGmail(
      async () => {
        const response = await gmail.users.history.list({
          userId: "me",
          startHistoryId,
          historyTypes: ["messageAdded"],
          pageToken,
        });
        return response.data;
      },
      budget,
    );
    historyId = data.historyId ?? historyId;
    for (const threadId of gmailHistoryChangedThreadIds(data.history)) {
      threadIds.add(threadId);
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  return { threadIds: [...threadIds], historyId };
}

async function listThreadIdsForQuery(
  gmail: gmail_v1.Gmail,
  budget: GmailQuotaBudget,
  q: string,
): Promise<string[]> {
  const threadIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const data = await callGmail(
      async () => {
        const response = await gmail.users.threads.list({
          userId: "me",
          maxResults: 100,
          q,
          pageToken,
        });
        return response.data;
      },
      budget,
    );
    for (const thread of data.threads ?? []) {
      if (thread.id) {
        threadIds.push(thread.id);
      }
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return threadIds;
}

async function listContactThreadIds(
  gmail: gmail_v1.Gmail,
  emails: readonly string[],
  mailboxAddresses: readonly string[],
  budget: GmailQuotaBudget,
): Promise<string[]> {
  const ids = new Set<string>();
  for (const q of gmailContactSearchQueries(emails, mailboxAddresses)) {
    for (const threadId of await listThreadIdsForQuery(gmail, budget, q)) {
      ids.add(threadId);
    }
  }
  return [...ids];
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
    latestToEmails: string[];
    latestCcEmails: string[];
    messageCount: number;
    inReplyTo: string | null;
    people: PersonEmail[];
    actor: Actor;
    mailboxAddresses: readonly string[];
  },
): Promise<{ id: string }> {
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

  let threadId: string;
  if (existing) {
    await db
      .update(emailThreads)
      .set({
        personId,
        subject: input.subject,
        lastMessageAt: input.lastMessageAt,
        snippet: input.snippet,
        participantEmails: input.participantEmails,
      })
      .where(eq(emailThreads.id, existing.id));
    threadId = existing.id;
  } else {
    const inserted = await db
      .insert(emailThreads)
      .values({
        personId,
        mailbox: input.mailbox,
        gmailThreadId: input.threadId,
        subject: input.subject,
        lastMessageAt: input.lastMessageAt,
        snippet: input.snippet,
        participantEmails: input.participantEmails,
        sharedVisible: false,
      })
      .returning({ id: emailThreads.id });
    const row = inserted[0];
    if (!row) {
      throw new Error("Failed to insert email thread");
    }
    threadId = row.id;
  }

  if (!personId || !isNewMessage) {
    return { id: threadId };
  }

  const person = input.people.find((row) => row.id === personId);
  if (!person) {
    return { id: threadId };
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
      personEmails: person.emails,
      messageCount: input.messageCount,
      inReplyTo: input.inReplyTo,
      mailboxAddresses: input.mailboxAddresses,
      toEmails: input.latestToEmails,
      ccEmails: input.latestCcEmails,
      threadMatched: true,
    })
  ) {
    await maybeMoveOnInboundReply(db, {
      personId,
      actor: input.actor,
      when: input.lastMessageAt,
    });
  }

  return { id: threadId };
}

async function upsertGmailMessages(
  db: Database,
  threadId: string,
  messages: gmail_v1.Schema$Message[],
): Promise<void> {
  const existingRows = await db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.threadId, threadId));
  const existingByGmailId = new Map(
    existingRows.map((row) => [row.gmailMessageId, row]),
  );

  for (const message of messages) {
    const gmailMessageId = message.id;
    if (!gmailMessageId) {
      continue;
    }
    const headers = message.payload?.headers ?? [];
    const fromEmail =
      parseEmailAddresses(headerValue(headers, "From"))[0] ?? "";
    const toEmails = uniqueEmails(parseEmailAddresses(headerValue(headers, "To")));
    const ccEmails = uniqueEmails(
      parseEmailAddresses(headerValue(headers, "Cc")),
    );
    const sentAt = new Date(Number(message.internalDate ?? Date.now()));
    const bodyText = extractGmailPlainText(message.payload);
    const snippet = emailSnippet(bodyText || message.snippet || "") || null;
    const existing = existingByGmailId.get(gmailMessageId);
    if (existing) {
      await db
        .update(emailMessages)
        .set({
          fromEmail,
          toEmails,
          ccEmails,
          sentAt,
          bodyText,
          snippet,
        })
        .where(eq(emailMessages.id, existing.id));
    } else {
      await db.insert(emailMessages).values({
        threadId,
        gmailMessageId,
        fromEmail,
        toEmails,
        ccEmails,
        sentAt,
        bodyText,
        snippet,
      });
    }
  }
}

async function rememberAlternateEmails(
  db: Database,
  person: PersonEmail,
  messages: readonly {
    fromEmail: string;
    toEmails: string[];
    ccEmails: string[];
  }[],
  mailboxAddresses: readonly string[],
): Promise<void> {
  for (const message of messages) {
    const alt = alternateEmailToRecord({
      fromEmail: message.fromEmail,
      toEmails: message.toEmails,
      ccEmails: message.ccEmails,
      personEmails: person.emails,
      mailboxAddresses,
    });
    if (!alt) {
      continue;
    }
    const taken = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.email, alt))
      .limit(1);
    if (taken[0] && taken[0].id !== person.id) {
      continue;
    }
    const inserted = await db
      .insert(personEmails)
      .values({
        personId: person.id,
        email: alt,
        source: "thread",
      })
      .onConflictDoNothing({ target: personEmails.email })
      .returning({ email: personEmails.email });
    if (inserted[0]) {
      person.emails = uniqueEmails([...person.emails, inserted[0].email]);
    }
  }
}

async function getGmailThread(
  gmail: gmail_v1.Gmail,
  threadId: string,
  format: "metadata" | "full",
  budget: GmailQuotaBudget,
): Promise<gmail_v1.Schema$Thread | null> {
  try {
    return await callGmail(
      async () => {
        const { data } = await gmail.users.threads.get({
          userId: "me",
          id: threadId,
          format,
          ...(format === "metadata"
            ? { metadataHeaders: [...GMAIL_METADATA_HEADERS] }
            : {}),
        });
        return data;
      },
      budget,
    );
  } catch (err) {
    if (isMissingGmailEntity(err)) {
      return null;
    }
    throw err;
  }
}

function sortGmailMessages(
  messages: gmail_v1.Schema$Message[],
): gmail_v1.Schema$Message[] {
  return [...messages].sort((a, b) => {
    const aDate = Number(a.internalDate ?? 0);
    const bDate = Number(b.internalDate ?? 0);
    return aDate - bDate;
  });
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
    budget: GmailQuotaBudget;
    env: Env;
    enqueueScore?: (input: {
      personId: string;
      trigger: Extract<ScoreTrigger, "inbound_email" | "inbound_reply">;
    }) => Promise<void>;
  },
): Promise<void> {
  const data = await getGmailThread(
    gmail,
    input.threadId,
    "metadata",
    input.budget,
  );
  if (!data) {
    return;
  }

  const messages = data.messages ?? [];
  if (messages.length === 0) {
    return;
  }

  const sorted = sortGmailMessages(messages);
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
  const latestToEmails = uniqueEmails(
    parseEmailAddresses(headerValue(latestHeaders, "To")),
  );
  const latestCcEmails = uniqueEmails(
    parseEmailAddresses(headerValue(latestHeaders, "Cc")),
  );
  const inReplyTo =
    headerValue(latestHeaders, "In-Reply-To") ||
    headerValue(latestHeaders, "References") ||
    null;
  const subject =
    headerValue(latestHeaders, "Subject") || data.snippet || "(no subject)";
  const lastMessageAt = new Date(Number(latest.internalDate ?? Date.now()));
  const matched = matchPersonFromParticipants(
    participantEmails,
    input.people,
    input.mailboxAddresses,
  );
  const person = matched
    ? input.people.find((row) => row.id === matched.id) ?? null
    : null;

  const full = await getGmailThread(
    gmail,
    input.threadId,
    "full",
    input.budget,
  );
  if (!full) {
    return;
  }
  const bodies = sortGmailMessages(full.messages ?? []);
  const latestFull = bodies[bodies.length - 1];
  const latestBody = extractGmailPlainText(latestFull?.payload);
  const snippet = emailSnippet(
    latestBody || latestFull?.snippet || full.snippet || data.snippet || "",
  );

  const thread = await upsertGmailThread(db, {
    mailbox: input.mailbox,
    threadId: input.threadId,
    subject,
    lastMessageAt,
    snippet,
    participantEmails,
    personId: person?.id ?? null,
    latestFrom,
    latestToEmails,
    latestCcEmails,
    messageCount: bodies.length,
    inReplyTo,
    people: input.people,
    actor: input.actor,
    mailboxAddresses: input.mailboxAddresses,
  });
  await upsertGmailMessages(db, thread.id, bodies);
  if (!person || !matched) {
    return;
  }
  const storedMessages = await db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.threadId, thread.id));
  await rememberAlternateEmails(db, person, storedMessages, input.mailboxAddresses);
  const personEmailsForDirection = person.emails;
  for (const message of storedMessages) {
    if (
      emailMessageDirection({
        fromEmail: message.fromEmail,
        personEmails: personEmailsForDirection,
        mailboxAddresses: input.mailboxAddresses,
        toEmails: message.toEmails,
        ccEmails: message.ccEmails,
        threadMatched: true,
      }) !== "inbound"
    ) {
      continue;
    }
    const ingested = await ingestExtractedText(db, {
      personId: matched.id,
      personEmail: matched.email,
      keyHex: input.env.EMAIL_HASH_KEY,
      resumeStorageDir: input.env.RESUME_STORAGE_DIR,
      text: message.bodyText,
      sourceType: "email_message",
      sourceEmailMessageId: message.id,
      actor: input.actor,
      occurredAt: message.sentAt,
    });
    if (ingested.optOut) {
      break;
    }
  }

  const hadInbound = storedMessages.some(
    (message) =>
      emailMessageDirection({
        fromEmail: message.fromEmail,
        personEmails: personEmailsForDirection,
        mailboxAddresses: input.mailboxAddresses,
        toEmails: message.toEmails,
        ccEmails: message.ccEmails,
        threadMatched: true,
      }) === "inbound",
  );
  if (hadInbound && input.enqueueScore) {
    const reply = isInboundReply({
      latestFrom,
      personEmails: personEmailsForDirection,
      messageCount: bodies.length,
      inReplyTo,
      mailboxAddresses: input.mailboxAddresses,
      toEmails: latestToEmails,
      ccEmails: latestCcEmails,
      threadMatched: true,
    });
    await input.enqueueScore({
      personId: matched.id,
      trigger: reply ? "inbound_reply" : "inbound_email",
    });
  }
}

export async function runGmailSync(
  db: Database,
  env: Env,
  rawData: unknown,
  extras?: {
    enqueueScore?: (input: {
      personId: string;
      trigger: Extract<ScoreTrigger, "inbound_email" | "inbound_reply">;
    }) => Promise<void>;
  },
): Promise<void> {
  const { mailbox } = gmailSyncJobDataSchema.parse(rawData);
  if (!isConfiguredMailbox(mailbox)) {
    return;
  }
  const connectionRows = await db
    .select()
    .from(mailboxConnections)
    .where(eq(mailboxConnections.mailbox, mailbox))
    .limit(1);
  const connection = connectionRows[0];
  if (!connection) {
    return;
  }

  let checkpoint: string | null = null;
  // False until every listed thread is processed. A missing historyId means
  // contact backfill is still in progress — treating that as complete lets a
  // quota pause persist getProfile's current historyId and skip the rest.
  let historyProcessingComplete = false;

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
    const budget = createGmailQuotaBudget();

    const profileAtStart = await callGmail(
      async () => {
        const response = await gmail.users.getProfile({ userId: "me" });
        return response.data;
      },
      budget,
    );
    checkpoint = gmailHistoryIdToPersist({
      capturedAtStart: profileAtStart.historyId ?? null,
    });

    let historyStale = false;
    let historyThreadIds: string[] = [];

    const initialPlan = gmailSyncPlan({
      storedHistoryId: connection.gmailHistoryId,
      lastError: connection.lastError,
      historyStale: false,
    });

    if (initialPlan.readHistory && connection.gmailHistoryId) {
      try {
        const changed = await listChangedThreadIds(
          gmail,
          connection.gmailHistoryId,
          budget,
        );
        historyThreadIds = changed.threadIds;
      } catch (err) {
        if (!isStaleHistory(err)) {
          throw err;
        }
        historyStale = true;
      }
    }

    const plan = gmailSyncPlan({
      storedHistoryId: connection.gmailHistoryId,
      lastError: connection.lastError,
      historyStale,
    });

    let backfillIds: string[] = [];
    if (plan.contactBackfill) {
      backfillIds = await listContactThreadIds(
        gmail,
        uniqueEmails(personRows.flatMap((person) => person.emails)),
        addresses,
        budget,
      );
    }

    const threadIds = [...new Set([...historyThreadIds, ...backfillIds])];
    const historyThreadIdSet = new Set(historyThreadIds);
    const skipThreadIds = gmailThreadIdsToSkip({
      skipStoredThreads: plan.skipStoredThreads,
      stored: plan.skipStoredThreads
        ? await storedGmailThreads(db, mailbox)
        : [],
    });

    for (const threadId of threadIds) {
      if (
        !shouldProcessGmailThreadId({
          threadId,
          historyThreadIds: historyThreadIdSet,
          skipThreadIds,
        })
      ) {
        continue;
      }
      await processGmailThread(gmail, db, {
        mailbox,
        threadId,
        people: personRows,
        actor,
        mailboxAddresses: addresses,
        budget,
        env,
        enqueueScore: extras?.enqueueScore,
      });
    }
    historyProcessingComplete = true;
    console.log(
      `gmail.sync ${mailbox} history=${historyThreadIds.length} backfill=${backfillIds.length} listed=${threadIds.length}`,
    );

    await markSyncOk(db, mailbox, checkpoint);
  } catch (err) {
    if (err instanceof GmailQuotaPausedError) {
      const persist = gmailSyncShouldPersistHistoryId({
        quotaPaused: true,
        historyProcessingComplete,
      });
      await markSyncError(
        db,
        mailbox,
        err.message,
        persist ? checkpoint : undefined,
      );
      return;
    }
    if (isMissingGmailEntity(err)) {
      await markSyncError(
        db,
        mailbox,
        err instanceof Error ? err.message : "Requested entity was not found.",
        null,
      );
      return;
    }
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
  const timeMin = new Date(now.getTime() - CALENDAR_SYNC_LOOKBACK_MS);
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

async function syncMeetingAttendeeAccepted(
  db: Database,
  input: {
    personId: string;
    calendarEventId: string;
    attendeeAccepted: boolean;
    scheduledAt: Date;
  },
): Promise<void> {
  await db
    .update(meetings)
    .set({
      attendeeAccepted: input.attendeeAccepted,
      scheduledAt: input.scheduledAt,
    })
    .where(
      and(
        eq(meetings.personId, input.personId),
        eq(meetings.calendarEventId, input.calendarEventId),
      ),
    );
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
    mailboxAddresses: readonly string[];
  },
): Promise<void> {
  const calendarEventId = input.event.id;
  if (!calendarEventId) {
    return;
  }

  const attendeeAccepted = calendarEventAttendeeAccepted({
    attendees: input.event.attendees ?? [],
    personEmails: input.person.emails,
    mailboxAddresses: input.mailboxAddresses,
  });

  const existingRows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.personId, input.person.id),
        eq(tasks.calendarEventId, calendarEventId),
      ),
    )
    .limit(1);
  const existing = existingRows[0];
  if (existing && existing.status !== "open") {
    await db
      .update(tasks)
      .set({ dueAt: input.scheduledAt, attendeeAccepted })
      .where(eq(tasks.id, existing.id));
    await syncMeetingAttendeeAccepted(db, {
      personId: input.person.id,
      calendarEventId,
      attendeeAccepted,
      scheduledAt: input.scheduledAt,
    });
    return;
  }

  const openWithoutEvent = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.personId, input.person.id),
        eq(tasks.kind, "meeting"),
        eq(tasks.status, "open"),
        isNull(tasks.calendarEventId),
      ),
    );
  const plan = planCalendarMeetingTask({
    existingByEventId: existing ? { id: existing.id } : null,
    openMeetingsWithoutEvent: openWithoutEvent.map((row) => ({
      id: row.id,
      dueAt: row.dueAt.toISOString(),
    })),
    scheduledAt: input.scheduledAt.toISOString(),
  });

  if (plan.closeDuplicateIds.length > 0) {
    const duplicates = openWithoutEvent.filter((row) =>
      plan.closeDuplicateIds.includes(row.id),
    );
    for (const duplicate of duplicates) {
      await db.delete(tasks).where(eq(tasks.id, duplicate.id));
      await writeActivity(db, {
        personId: input.person.id,
        userId: input.actor.id,
        type: "note",
        payload: {
          who: { id: input.actor.id, email: input.actor.email },
          what: "task.delete",
          when: new Date().toISOString(),
          before: {
            taskId: duplicate.id,
            kind: duplicate.kind,
            notes: duplicate.notes,
          },
          after: { reason: "calendar_duplicate" },
        },
      });
    }
  }

  if (input.cancelled) {
    const resolution = cancelledMeetingResolution(input.hasReplacement);
    const outcome = resolution === "rescheduled" ? "rescheduled" : "scheduled";
    const status = resolution === "rescheduled" ? "rescheduled" : "open";
    const needsReview = resolution === "needs_review";
    if (plan.action === "update") {
      await db
        .update(tasks)
        .set({
          dueAt: input.scheduledAt,
          calendarEventId,
          outcome,
          status,
          needsReview,
          attendeeAccepted,
        })
        .where(eq(tasks.id, plan.taskId));
      await syncMeetingAttendeeAccepted(db, {
        personId: input.person.id,
        calendarEventId,
        attendeeAccepted,
        scheduledAt: input.scheduledAt,
      });
      return;
    }
    await db.insert(tasks).values({
      personId: input.person.id,
      kind: "meeting",
      dueAt: input.scheduledAt,
      calendarEventId,
      outcome,
      status,
      needsReview,
      attendeeAccepted,
      createdBy: input.actor.id,
    });
    await syncMeetingAttendeeAccepted(db, {
      personId: input.person.id,
      calendarEventId,
      attendeeAccepted,
      scheduledAt: input.scheduledAt,
    });
    return;
  }

  if (plan.action === "update") {
    await db
      .update(tasks)
      .set({
        dueAt: input.scheduledAt,
        calendarEventId,
        needsReview: false,
        attendeeAccepted,
      })
      .where(eq(tasks.id, plan.taskId));
    await syncMeetingAttendeeAccepted(db, {
      personId: input.person.id,
      calendarEventId,
      attendeeAccepted,
      scheduledAt: input.scheduledAt,
    });
    return;
  }

  await db.insert(tasks).values({
    personId: input.person.id,
    kind: "meeting",
    dueAt: input.scheduledAt,
    calendarEventId,
    outcome: "scheduled",
    status: "open",
    needsReview: false,
    attendeeAccepted,
    createdBy: input.actor.id,
  });

  await syncMeetingAttendeeAccepted(db, {
    personId: input.person.id,
    calendarEventId,
    attendeeAccepted,
    scheduledAt: input.scheduledAt,
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
  extras?: {
    enqueueScore?: (input: {
      personId: string;
      trigger: Extract<ScoreTrigger, "meeting_held">;
    }) => Promise<void>;
  },
): Promise<void> {
  const { mailbox } = calendarSyncJobDataSchema.parse(rawData);
  if (!isConfiguredMailbox(mailbox)) {
    return;
  }
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

    const scoredPersonIds = new Set<string>();
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
          mailboxAddresses: addresses,
        });
        scoredPersonIds.add(person.id);
      }
    }

    if (extras?.enqueueScore) {
      for (const personId of scoredPersonIds) {
        await extras.enqueueScore({ personId, trigger: "meeting_held" });
      }
    }

    // Gmail owns lastSyncedAt / lastError on this row. Calendar success
    // must not hide a stalled Gmail checkpoint.
  } catch (err) {
    if (isMissingGmailEntity(err)) {
      return;
    }
    const message = err instanceof Error ? err.message : "Calendar sync failed";
    await markSyncError(db, mailbox, message);
    throw err;
  }
}
