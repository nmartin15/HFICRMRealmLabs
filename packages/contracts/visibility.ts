import type { Mailbox, UserRole } from "./enums";
import { PERSONAL_MAILBOX_EMAIL } from "./mailboxes";
import { normalizeEmail } from "./hosted-domain";

export type EmailThreadVisibilityInput = {
  mailbox: Mailbox;
  sharedVisible: boolean;
  viewerEmail: string;
  personalMailboxEmail?: string;
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
 * Shared mailbox threads are visible to everyone.
 * Personal mailbox threads are visible only to the mailbox owner unless
 * shared_visible is true.
 *
 * Owner is the CRM user whose email matches the personal mailbox account
 * (nathan@realmlabs.co). TODO(Prompt 5): resolve owner via connected mailbox rows.
 */
export function canViewEmailThread(input: EmailThreadVisibilityInput): boolean {
  if (input.mailbox === "shared") {
    return true;
  }
  if (input.sharedVisible) {
    return true;
  }
  const ownerEmail = normalizeEmail(
    input.personalMailboxEmail ?? PERSONAL_MAILBOX_EMAIL,
  );
  return normalizeEmail(input.viewerEmail) === ownerEmail;
}

export function canDeletePerson(role: UserRole): boolean {
  return role === "admin";
}

export function canChangeUserRole(role: UserRole): boolean {
  return role === "admin";
}

export function canConnectMailbox(role: UserRole): boolean {
  return role === "admin";
}

/** Do Not Contact people are omitted from lists and exports. The record page still loads. */
export function isListedPerson(doNotContact: boolean): boolean {
  return !doNotContact;
}
