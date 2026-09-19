import {
  gmailContactSearchQueries,
  matchPersonFromParticipants,
  mailboxEmails,
  type PersonEmailMatch,
} from "./email-matching";

export const GMAIL_QUOTA_PAUSED_MESSAGE =
  "Gmail quota paused; next sync will continue";

export const GMAIL_METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Bcc",
  "Subject",
  "Date",
  "In-Reply-To",
  "References",
] as const;

export type GmailSyncPlan = {
  readHistory: boolean;
  contactBackfill: boolean;
  skipStoredThreads: boolean;
};

/**
 * Cloud mailboxes stall when a long contact backfill hits quota, then the next
 * run either skips already-stored threads (dropping new replies) or advances
 * historyId past mail that was never processed.
 */
export function gmailLastErrorMeansHistoryStale(
  lastError: string | null,
): boolean {
  if (!lastError || lastError === GMAIL_QUOTA_PAUSED_MESSAGE) {
    return false;
  }
  const message = lastError.toLowerCase();
  return (
    message.includes("requested entity was not found") ||
    message.includes("historyid")
  );
}

export function gmailSyncPlan(input: {
  storedHistoryId: string | null;
  lastError: string | null;
  historyStale: boolean;
}): GmailSyncPlan {
  const quotaPaused = input.lastError === GMAIL_QUOTA_PAUSED_MESSAGE;
  const hasHistoryId = Boolean(input.storedHistoryId);

  if (!hasHistoryId) {
    return {
      readHistory: false,
      contactBackfill: true,
      skipStoredThreads: true,
    };
  }

  if (input.historyStale || gmailLastErrorMeansHistoryStale(input.lastError)) {
    return {
      readHistory: false,
      contactBackfill: true,
      skipStoredThreads: false,
    };
  }

  return {
    readHistory: true,
    contactBackfill: quotaPaused,
    skipStoredThreads: quotaPaused,
  };
}

export function gmailHistoryIdToPersist(input: {
  capturedAtStart: string | null;
  laterProfileHistoryId?: string | null;
}): string | null {
  return input.capturedAtStart;
}

export function gmailSyncShouldPersistHistoryId(input: {
  quotaPaused: boolean;
  historyProcessingComplete: boolean;
}): boolean {
  if (input.quotaPaused && !input.historyProcessingComplete) {
    return false;
  }
  return true;
}

export function gmailThreadIdsToSkip(input: {
  skipStoredThreads: boolean;
  stored: readonly {
    gmailThreadId: string;
    personId: string | null;
    hasMessage: boolean;
  }[];
}): Set<string> {
  if (!input.skipStoredThreads) {
    return new Set();
  }
  const skip = new Set<string>();
  for (const row of input.stored) {
    if (row.hasMessage) {
      skip.add(row.gmailThreadId);
    }
  }
  return skip;
}

export function gmailHistoryChangedThreadIds(
  history:
    | readonly {
        messagesAdded?: readonly {
          message?: { threadId?: string | null } | null;
        }[] | null;
        messages?: readonly { threadId?: string | null }[] | null;
      }[]
    | null
    | undefined,
): string[] {
  const threadIds = new Set<string>();
  for (const item of history ?? []) {
    for (const added of item.messagesAdded ?? []) {
      const threadId = added.message?.threadId;
      if (threadId) {
        threadIds.add(threadId);
      }
    }
    for (const message of item.messages ?? []) {
      const threadId = message?.threadId;
      if (threadId) {
        threadIds.add(threadId);
      }
    }
  }
  return [...threadIds];
}

export function shouldProcessGmailThreadId(input: {
  threadId: string;
  historyThreadIds: ReadonlySet<string>;
  skipThreadIds: ReadonlySet<string>;
}): boolean {
  if (input.historyThreadIds.has(input.threadId)) {
    return true;
  }
  return !input.skipThreadIds.has(input.threadId);
}

/** Only CRM contact threads are stored. Newsletters and unknown senders are dropped. */
export function shouldIngestGmailThread(input: {
  participantEmails: readonly string[];
  people: readonly PersonEmailMatch[];
  mailboxAddresses?: readonly string[];
}): boolean {
  return (
    matchPersonFromParticipants(
      input.participantEmails,
      input.people,
      input.mailboxAddresses ?? mailboxEmails(),
    ) !== null
  );
}

export function gmailContactBackfillQueries(
  emails: readonly string[],
  mailboxAddresses?: readonly string[],
): string[] {
  return gmailContactSearchQueries(
    emails,
    mailboxAddresses ?? mailboxEmails(),
  );
}
