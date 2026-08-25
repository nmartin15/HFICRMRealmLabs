import { CONFIGURED_MAILBOXES } from "./mailboxes";
import { normalizeEmail } from "./hosted-domain";

export const EMAIL_SNIPPET_MAX_CHARS = 300;

const ADDRESS_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function mailboxEmails(
  configured = CONFIGURED_MAILBOXES,
): readonly string[] {
  return configured.map((item) => normalizeEmail(item.email));
}

/** Lowercase and strip plus-tagging from the local part (`jane+jobs@x.com` → `jane@x.com`). */
export function canonicalEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) {
    return normalized;
  }
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const plus = local.indexOf("+");
  const canonicalLocal = plus === -1 ? local : local.slice(0, plus);
  return `${canonicalLocal}@${domain}`;
}

export function emailsMatch(a: string, b: string): boolean {
  return canonicalEmail(a) === canonicalEmail(b);
}

export function parseEmailAddresses(header: string): string[] {
  const matches = header.match(ADDRESS_RE);
  if (!matches) {
    return [];
  }
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const match of matches) {
    const email = normalizeEmail(match);
    if (seen.has(email)) {
      continue;
    }
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

export function uniqueEmails(emails: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const email of emails) {
    const normalized = normalizeEmail(email);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function isMailboxAddress(
  email: string,
  mailboxAddresses: readonly string[] = mailboxEmails(),
): boolean {
  return mailboxAddresses.some((mailbox) => emailsMatch(email, mailbox));
}

export function emailSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, EMAIL_SNIPPET_MAX_CHARS);
}

export type PersonEmailMatch = {
  id: string;
  email: string;
};

/**
 * First participant that matches a person, skipping our mailbox addresses.
 * Matching is case-insensitive and ignores plus addressing on either side.
 */
export function matchPersonFromParticipants(
  participantEmails: readonly string[],
  people: readonly PersonEmailMatch[],
  mailboxAddresses: readonly string[] = mailboxEmails(),
): PersonEmailMatch | null {
  for (const participant of participantEmails) {
    if (isMailboxAddress(participant, mailboxAddresses)) {
      continue;
    }
    const person = people.find((row) => emailsMatch(row.email, participant));
    if (person) {
      return person;
    }
  }
  return null;
}

export function isInboundFromPerson(
  latestFrom: string | null,
  personEmail: string,
  mailboxAddresses: readonly string[] = mailboxEmails(),
): boolean {
  if (!latestFrom) {
    return false;
  }
  if (isMailboxAddress(latestFrom, mailboxAddresses)) {
    return false;
  }
  return emailsMatch(latestFrom, personEmail);
}

export function isInboundReply(input: {
  latestFrom: string | null;
  personEmail: string;
  messageCount: number;
  inReplyTo: string | null;
  mailboxAddresses?: readonly string[];
}): boolean {
  if (
    !isInboundFromPerson(
      input.latestFrom,
      input.personEmail,
      input.mailboxAddresses ?? mailboxEmails(),
    )
  ) {
    return false;
  }
  if (input.messageCount > 1) {
    return true;
  }
  return Boolean(input.inReplyTo?.trim());
}
