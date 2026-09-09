import type { Mailbox, UserRole } from "./enums";
import { mailboxEmailFor } from "./mailboxes";
import { normalizeEmail } from "./hosted-domain";

export type EmailThreadVisibilityInput = {
  mailbox: Mailbox;
  sharedVisible: boolean;
  viewerEmail: string;
  mailboxEmail?: string;
  linkedToPerson?: boolean;
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
 * Matched contact threads are visible to every operator. Unmatched threads
 * stay private to that mailbox unless shared_visible is true.
 */
export function canViewEmailThread(input: EmailThreadVisibilityInput): boolean {
  if (input.sharedVisible || input.linkedToPerson) {
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

/**
 * Home snapshot only. Contact-record tasks are shared so operators do not
 * duplicate outreach.
 */
export function canViewOperatorTask(input: {
  role: UserRole;
  viewerId: string;
  createdBy: string;
  includeAllOperators: boolean;
}): boolean {
  if (input.createdBy === input.viewerId) {
    return true;
  }
  return input.role === "admin" && input.includeAllOperators;
}

/** Do Not Contact people are omitted from lists and exports. The record page still loads. */
export function isListedPerson(doNotContact: boolean): boolean {
  return !doNotContact;
}
