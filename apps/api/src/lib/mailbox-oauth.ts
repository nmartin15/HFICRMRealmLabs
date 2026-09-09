import {
  canConnectMailbox,
  isConfiguredMailbox,
  isHostedDomainClaim,
  isHostedDomainEmail,
  mailboxEmailFor,
  mailboxSchema,
  normalizeEmail,
  type Mailbox,
} from "@realm-labs/contracts";
import { encryptSecret, mailboxConnections, type Database } from "@realm-labs/db";
import { eq } from "drizzle-orm";
import type { Env } from "../env.js";
import { exchangeGoogleMailboxCode } from "./google.js";
import { enqueueMailboxSync, type SyncQueues } from "./queues.js";
import type { AuthedUser } from "../plugins/auth.js";

export const MAILBOX_OAUTH_COOKIE = "rl_mailbox_oauth_state";

export function encodeMailboxState(mailbox: Mailbox): string {
  return `${mailbox}.${Buffer.from(`${Date.now()}:${Math.random()}`).toString("base64url")}`;
}

export function decodeMailboxState(state: string): Mailbox | null {
  const parsed = mailboxSchema.safeParse(state.split(".")[0]);
  return parsed.success ? parsed.data : null;
}

export type MailboxOAuthResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export async function completeMailboxOAuth(input: {
  db: Database;
  env: Env;
  queues: SyncQueues;
  actor: AuthedUser | undefined;
  mailbox: Mailbox;
  code: string;
  onEnqueueError?: (err: unknown) => void;
}): Promise<MailboxOAuthResult> {
  if (!isConfiguredMailbox(input.mailbox)) {
    return {
      ok: false,
      code: "OAUTH_ERROR",
      message: "This mailbox is not in use",
    };
  }

  const expectedEmail = mailboxEmailFor(input.mailbox);
  if (
    !input.actor ||
    !canConnectMailbox({
      role: input.actor.role,
      actorEmail: input.actor.email,
      mailboxEmail: expectedEmail,
    })
  ) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "You cannot connect this mailbox",
    };
  }

  try {
    const grant = await exchangeGoogleMailboxCode(input.env, input.code);
    const email = normalizeEmail(grant.email);

    if (!email || !grant.id) {
      return {
        ok: false,
        code: "OAUTH_ERROR",
        message: "Google account has no email",
      };
    }

    if (
      !isHostedDomainEmail(email, input.env.ALLOWED_HOSTED_DOMAIN) ||
      !isHostedDomainClaim(grant.hd, input.env.ALLOWED_HOSTED_DOMAIN)
    ) {
      return {
        ok: false,
        code: "DOMAIN_NOT_ALLOWED",
        message: `Mailbox connect is restricted to ${input.env.ALLOWED_HOSTED_DOMAIN} accounts`,
      };
    }

    if (email !== expectedEmail) {
      return {
        ok: false,
        code: "MAILBOX_MISMATCH",
        message: `Sign in as ${expectedEmail} to connect the ${input.mailbox} mailbox`,
      };
    }

    const encrypted = encryptSecret(
      grant.refreshToken,
      input.env.TOKEN_ENCRYPTION_KEY,
    );
    const now = new Date();

    const existing = await input.db
      .select({ id: mailboxConnections.id })
      .from(mailboxConnections)
      .where(eq(mailboxConnections.mailbox, input.mailbox))
      .limit(1);

    if (existing[0]) {
      await input.db
        .update(mailboxConnections)
        .set({
          email,
          connectedBy: input.actor.id,
          refreshTokenEncrypted: encrypted,
          googleSub: grant.id,
          gmailHistoryId: null,
          lastError: null,
          connectedAt: now,
        })
        .where(eq(mailboxConnections.mailbox, input.mailbox));
    } else {
      await input.db.insert(mailboxConnections).values({
        mailbox: input.mailbox,
        email,
        connectedBy: input.actor.id,
        refreshTokenEncrypted: encrypted,
        googleSub: grant.id,
        lastError: null,
        connectedAt: now,
      });
    }

    try {
      await enqueueMailboxSync(input.queues, input.mailbox);
    } catch (err) {
      input.onEnqueueError?.(err);
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      code: "OAUTH_ERROR",
      message: err instanceof Error ? err.message : "Mailbox connect failed",
    };
  }
}
