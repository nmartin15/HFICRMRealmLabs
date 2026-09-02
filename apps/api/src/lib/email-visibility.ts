import {
  PERSONAL_MAILBOX_EMAIL,
  canViewEmailThread,
  type Mailbox,
} from "@realm-labs/contracts";
import { eq, or, type SQL } from "drizzle-orm";
import { emailThreads, mailboxConnections, type Database } from "@realm-labs/db";

export type PersonalMailboxOwner = {
  email: string;
  connectedBy: string;
};

export async function loadPersonalMailboxOwner(
  db: Database,
): Promise<PersonalMailboxOwner | null> {
  const rows = await db
    .select({
      email: mailboxConnections.email,
      connectedBy: mailboxConnections.connectedBy,
    })
    .from(mailboxConnections)
    .where(eq(mailboxConnections.mailbox, "personal"))
    .limit(1);
  return rows[0] ?? null;
}

export function emailThreadsVisibleSql(
  viewer: { id: string; email: string },
  owner: PersonalMailboxOwner | null,
): SQL | undefined {
  if (
    canViewEmailThread({
      mailbox: "personal",
      sharedVisible: false,
      viewerEmail: viewer.email,
      viewerId: viewer.id,
      personalMailboxEmail: owner?.email ?? PERSONAL_MAILBOX_EMAIL,
      personalMailboxConnectedBy: owner?.connectedBy,
    })
  ) {
    return undefined;
  }

  return or(
    eq(emailThreads.mailbox, "shared"),
    eq(emailThreads.sharedVisible, true),
  );
}

export function emailThreadRowVisible(
  row: { mailbox: Mailbox; sharedVisible: boolean },
  viewer: { id: string; email: string },
  owner: PersonalMailboxOwner | null,
): boolean {
  return canViewEmailThread({
    mailbox: row.mailbox,
    sharedVisible: row.sharedVisible,
    viewerEmail: viewer.email,
    viewerId: viewer.id,
    personalMailboxEmail: owner?.email ?? PERSONAL_MAILBOX_EMAIL,
    personalMailboxConnectedBy: owner?.connectedBy,
  });
}
