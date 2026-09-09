import { MAILBOX_ADDRESSES } from "./mailboxes";
import { normalizeEmail } from "./hosted-domain";
import type { EmailMessageDirection } from "./email-messages";

export const EMAIL_SNIPPET_MAX_CHARS = 300;

const ADDRESS_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function mailboxEmails(
  addresses: readonly string[] = Object.values(MAILBOX_ADDRESSES),
): readonly string[] {
  return addresses.map((email) => normalizeEmail(email));
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

export function emailMessageDirection(input: {
  fromEmail: string;
  personEmail: string | null;
  mailboxAddresses?: readonly string[];
}): EmailMessageDirection {
  const mailboxes = input.mailboxAddresses ?? mailboxEmails();
  if (!input.fromEmail.trim()) {
    return "other";
  }
  if (isMailboxAddress(input.fromEmail, mailboxes)) {
    return "outbound";
  }
  if (input.personEmail && emailsMatch(input.fromEmail, input.personEmail)) {
    return "inbound";
  }
  return "other";
}

export type GmailMimePart = {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailMimePart[] | null;
};

export function decodeGmailBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded =
    normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function fromCodePoint(code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
    return "";
  }
  return String.fromCodePoint(code);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec: string) =>
      fromCodePoint(Number.parseInt(dec, 10)),
    );
}

export function htmlToPlainText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const withBreaks = withoutNoise
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(stripped).replace(/\n{3,}/g, "\n\n").trim();
}

function collectMimeText(part: GmailMimePart | null | undefined): {
  plains: string[];
  htmls: string[];
} {
  const plains: string[] = [];
  const htmls: string[] = [];
  if (!part) {
    return { plains, htmls };
  }

  const filename = part.filename?.trim() ?? "";
  const mime = (part.mimeType ?? "").toLowerCase();
  if (filename && !mime.startsWith("text/")) {
    return { plains, htmls };
  }

  if (mime === "text/plain" && part.body?.data) {
    plains.push(decodeGmailBase64Url(part.body.data));
  } else if (mime === "text/html" && part.body?.data) {
    htmls.push(decodeGmailBase64Url(part.body.data));
  }

  for (const child of part.parts ?? []) {
    const nested = collectMimeText(child);
    plains.push(...nested.plains);
    htmls.push(...nested.htmls);
  }
  return { plains, htmls };
}

/** Prefer text/plain MIME parts; fall back to stripped HTML. Never truncates. */
export function extractGmailPlainText(
  part: GmailMimePart | null | undefined,
): string {
  const { plains, htmls } = collectMimeText(part);
  if (plains.length > 0) {
    return plains.join("\n\n").trim();
  }
  if (htmls.length > 0) {
    return htmlToPlainText(htmls.join("\n")).trim();
  }
  return "";
}
