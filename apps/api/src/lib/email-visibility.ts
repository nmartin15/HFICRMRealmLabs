import {
  ALL_MAILBOXES,
  canViewEmailThread,
  mailboxEmailFor,
  type Mailbox,
} from "@realm-labs/contracts";
import { eq, isNotNull, or, type SQL } from "drizzle-orm";
import { emailThreads, mailboxConnections, type Database } from "@realm-labs/db";

export type MailboxOwner = {
  mailbox: Mailbox;
  email: string;
  connectedBy: string;
};

export async function loadMailboxOwners(
  db: Database,
): Promise<MailboxOwner[]> {
  return db
    .select({
      mailbox: mailboxConnections.mailbox,
      email: mailboxConnections.email,
      connectedBy: mailboxConnections.connectedBy,
    })
    .from(mailboxConnections);
}

function ownerFor(
  owners: readonly MailboxOwner[],
  mailbox: Mailbox,
): MailboxOwner | undefined {
  return owners.find((row) => row.mailbox === mailbox);
}

function mailboxEmail(
  owners: readonly MailboxOwner[],
  mailbox: Mailbox,
): string {
  return ownerFor(owners, mailbox)?.email ?? mailboxEmailFor(mailbox);
}

export function emailThreadsVisibleSql(
  viewer: { id: string; email: string },
  owners: readonly MailboxOwner[],
): SQL | undefined {
  const owned = ALL_MAILBOXES.filter((mailbox) =>
    canViewEmailThread({
      mailbox,
      sharedVisible: false,
      viewerEmail: viewer.email,
      mailboxEmail: mailboxEmail(owners, mailbox),
    }),
  );

  if (owned.length === ALL_MAILBOXES.length) {
    return undefined;
  }

  return or(
    isNotNull(emailThreads.personId),
    eq(emailThreads.sharedVisible, true),
    ...owned.map((mailbox) => eq(emailThreads.mailbox, mailbox)),
  );
}

export function emailThreadRowVisible(
  row: { mailbox: Mailbox; sharedVisible: boolean; personId?: string | null },
  viewer: { id: string; email: string },
  owners: readonly MailboxOwner[],
): boolean {
  return canViewEmailThread({
    mailbox: row.mailbox,
    sharedVisible: row.sharedVisible,
    linkedToPerson: Boolean(row.personId),
    viewerEmail: viewer.email,
    mailboxEmail: mailboxEmail(owners, row.mailbox),
  });
}
