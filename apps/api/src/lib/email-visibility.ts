import { canViewEmailThread, PERSONAL_MAILBOX_EMAIL, type Mailbox } from "@realm-labs/contracts";
import { eq, or, type SQL } from "drizzle-orm";
import { emailThreads } from "@realm-labs/db";

export function emailThreadsVisibleSql(viewerEmail: string): SQL | undefined {
  if (
    canViewEmailThread({
      mailbox: "personal",
      sharedVisible: false,
      viewerEmail,
      personalMailboxEmail: PERSONAL_MAILBOX_EMAIL,
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
  viewerEmail: string,
): boolean {
  return canViewEmailThread({
    mailbox: row.mailbox,
    sharedVisible: row.sharedVisible,
    viewerEmail,
  });
}
