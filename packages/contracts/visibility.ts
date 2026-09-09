import type { Mailbox, UserRole } from "./enums";
import { mailboxEmailFor } from "./mailboxes";
import { normalizeEmail } from "./hosted-domain";

export type EmailThreadVisibilityInput = {
  mailbox: Mailbox;
  sharedVisible: boolean;
  viewerEmail: string;
  mailboxEmail?: string;
};

/**
 * Small-team CRM: every authenticated user can see every person, card,
 * meeting, and activity. No owner partitioning.
 */
export function canViewPerson(): boolean {
  return true;
}

export function canViewCard(): boolean {
  return true;
}

export function canViewMeeting(): boolean {
  return true;
}

export function canViewActivity(): boolean {
  return true;
}

/**
 * Operator mailbox threads are visible only to that operator unless
 * shared_visible is true. Owner is the configured mailbox address
 * (or the connected Google email when supplied).
 */
export function canViewEmailThread(input: EmailThreadVisibilityInput): boolean {
  if (input.sharedVisible) {
    return true;
  }
  const ownerEmail = normalizeEmail(
    input.mailboxEmail ?? mailboxEmailFor(input.mailbox),
  );
  return normalizeEmail(input.viewerEmail) === ownerEmail;
}

export function canDeletePerson(role: UserRole): boolean {
  return role === "admin";
}

export function canChangeUserRole(role: UserRole): boolean {
  return role === "admin";
}

export function canConnectMailbox(input: {
  role: UserRole;
  actorEmail: string;
  mailboxEmail: string;
}): boolean {
  if (input.role === "admin") {
    return true;
  }
  return (
    normalizeEmail(input.actorEmail) === normalizeEmail(input.mailboxEmail)
  );
}

/** Do Not Contact people are omitted from lists and exports. The record page still loads. */
export function isListedPerson(doNotContact: boolean): boolean {
  return !doNotContact;
}
