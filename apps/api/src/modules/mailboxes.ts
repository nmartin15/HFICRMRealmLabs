import {
  CONFIGURED_MAILBOXES,
  canConnectMailbox,
  googleCallbackQuerySchema,
  googleStartResponseSchema,
  isHostedDomainClaim,
  isHostedDomainEmail,
  mailboxConnectionListResponseSchema,
  mailboxEmailFor,
  mailboxParamsSchema,
  normalizeEmail,
  okResponseSchema,
  type Mailbox,
  type MailboxConnection,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { encryptSecret, mailboxConnections } from "@realm-labs/db";
import { eq } from "drizzle-orm";
import { googleConfigured } from "../env.js";
import {
  exchangeGoogleMailboxCode,
  googleMailboxUrl,
  mailboxOauthErrorRedirect,
  mailboxOauthSuccessRedirect,
} from "../lib/google.js";
import { enqueueMailboxSync, removeMailboxSync } from "../lib/queues.js";
import { requireAdmin, requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

const MAILBOX_OAUTH_COOKIE = "rl_mailbox_oauth_state";

function randomState(): string {
  return Buffer.from(`${Date.now()}:${Math.random()}`).toString("base64url");
}

function encodeMailboxState(mailbox: Mailbox): string {
  return `${mailbox}.${randomState()}`;
}

function decodeMailboxState(state: string): Mailbox | null {
  const mailbox = state.split(".")[0];
  if (mailbox === "personal" || mailbox === "shared") {
    return mailbox;
  }
  return null;
}

function serializeConnection(
  mailbox: (typeof CONFIGURED_MAILBOXES)[number],
  row:
    | {
        lastSyncedAt: Date | null;
        lastError: string | null;
        connectedAt: Date;
      }
    | undefined,
): MailboxConnection {
  return {
    ...mailbox,
    connected: Boolean(row),
    lastSyncedAt: row?.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    lastError: row?.lastError ?? null,
    connectedAt: row?.connectedAt ? row.connectedAt.toISOString() : null,
  };
}

export const mailboxRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/mailboxes",
    {
      schema: {
        response: { 200: mailboxConnectionListResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      const rows = await app.db.select().from(mailboxConnections);
      const byMailbox = new Map(rows.map((row) => [row.mailbox, row]));
      return {
        data: CONFIGURED_MAILBOXES.map((mailbox) =>
          serializeConnection(mailbox, byMailbox.get(mailbox.mailbox)),
        ),
      };
    },
  );

  app.post(
    "/mailboxes/:mailbox/google",
    {
      schema: {
        params: mailboxParamsSchema,
        response: { 200: googleStartResponseSchema },
      },
    },
    async (req, reply) => {
      const actor = requireAdmin(req);
      if (!canConnectMailbox(actor.role)) {
        throw httpError(403, "FORBIDDEN", "Only admin can connect mailboxes");
      }
      if (!googleConfigured(app.env)) {
        throw httpError(
          503,
          "GOOGLE_NOT_CONFIGURED",
          "Google OAuth is not configured",
        );
      }

      const state = encodeMailboxState(req.params.mailbox);
      reply.setCookie(MAILBOX_OAUTH_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax",
        secure: app.env.NODE_ENV === "production",
        path: "/",
        maxAge: 600,
      });

      return { url: googleMailboxUrl(app.env, state, req.params.mailbox) };
    },
  );

  app.get(
    "/mailboxes/google/callback",
    {
      schema: {
        querystring: googleCallbackQuerySchema,
      },
    },
    async (req, reply) => {
      const actor = req.user;
      if (!actor || !canConnectMailbox(actor.role)) {
        return reply.redirect(
          mailboxOauthErrorRedirect(
            app.env.WEB_ORIGIN,
            "FORBIDDEN",
            "Only admin can connect mailboxes",
          ),
        );
      }

      if (!googleConfigured(app.env)) {
        return reply.redirect(
          mailboxOauthErrorRedirect(
            app.env.WEB_ORIGIN,
            "GOOGLE_NOT_CONFIGURED",
            "Google OAuth is not configured",
          ),
        );
      }

      const query = req.query;
      if (query.error || !query.code) {
        return reply.redirect(
          mailboxOauthErrorRedirect(
            app.env.WEB_ORIGIN,
            "OAUTH_ERROR",
            query.error ?? "Missing authorization code",
          ),
        );
      }

      const expectedState = req.cookies[MAILBOX_OAUTH_COOKIE];
      if (!expectedState || !query.state || expectedState !== query.state) {
        return reply.redirect(
          mailboxOauthErrorRedirect(
            app.env.WEB_ORIGIN,
            "OAUTH_ERROR",
            "Invalid OAuth state",
          ),
        );
      }

      const mailbox = decodeMailboxState(query.state);
      reply.clearCookie(MAILBOX_OAUTH_COOKIE, { path: "/" });
      if (!mailbox) {
        return reply.redirect(
          mailboxOauthErrorRedirect(
            app.env.WEB_ORIGIN,
            "OAUTH_ERROR",
            "Invalid OAuth state",
          ),
        );
      }

      try {
        const grant = await exchangeGoogleMailboxCode(app.env, query.code);
        const email = normalizeEmail(grant.email);
        const expectedEmail = mailboxEmailFor(mailbox);

        if (!email || !grant.id) {
          return reply.redirect(
            mailboxOauthErrorRedirect(
              app.env.WEB_ORIGIN,
              "OAUTH_ERROR",
              "Google account has no email",
            ),
          );
        }

        if (
          !isHostedDomainEmail(email, app.env.ALLOWED_HOSTED_DOMAIN) ||
          !isHostedDomainClaim(grant.hd, app.env.ALLOWED_HOSTED_DOMAIN)
        ) {
          return reply.redirect(
            mailboxOauthErrorRedirect(
              app.env.WEB_ORIGIN,
              "DOMAIN_NOT_ALLOWED",
              `Mailbox connect is restricted to ${app.env.ALLOWED_HOSTED_DOMAIN} accounts`,
            ),
          );
        }

        if (email !== expectedEmail) {
          return reply.redirect(
            mailboxOauthErrorRedirect(
              app.env.WEB_ORIGIN,
              "MAILBOX_MISMATCH",
              `Sign in as ${expectedEmail} to connect the ${mailbox} mailbox`,
            ),
          );
        }

        const encrypted = encryptSecret(
          grant.refreshToken,
          app.env.TOKEN_ENCRYPTION_KEY,
        );
        const now = new Date();

        const existing = await app.db
          .select({ id: mailboxConnections.id })
          .from(mailboxConnections)
          .where(eq(mailboxConnections.mailbox, mailbox))
          .limit(1);

        if (existing[0]) {
          await app.db
            .update(mailboxConnections)
            .set({
              email,
              connectedBy: actor.id,
              refreshTokenEncrypted: encrypted,
              googleSub: grant.id,
              gmailHistoryId: null,
              lastError: null,
              connectedAt: now,
            })
            .where(eq(mailboxConnections.mailbox, mailbox));
        } else {
          await app.db.insert(mailboxConnections).values({
            mailbox,
            email,
            connectedBy: actor.id,
            refreshTokenEncrypted: encrypted,
            googleSub: grant.id,
            lastError: null,
            connectedAt: now,
          });
        }

        try {
          await enqueueMailboxSync(app.queues, mailbox);
        } catch (err) {
          req.log.error({ err }, "failed to enqueue mailbox sync");
        }

        return reply.redirect(mailboxOauthSuccessRedirect(app.env.WEB_ORIGIN));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Mailbox connect failed";
        return reply.redirect(
          mailboxOauthErrorRedirect(app.env.WEB_ORIGIN, "OAUTH_ERROR", message),
        );
      }
    },
  );

  app.delete(
    "/mailboxes/:mailbox",
    {
      schema: {
        params: mailboxParamsSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      const actor = requireAdmin(req);
      if (!canConnectMailbox(actor.role)) {
        throw httpError(403, "FORBIDDEN", "Only admin can disconnect mailboxes");
      }

      await app.db
        .delete(mailboxConnections)
        .where(eq(mailboxConnections.mailbox, req.params.mailbox));

      try {
        await removeMailboxSync(app.queues, req.params.mailbox);
      } catch (err) {
        req.log.error({ err }, "failed to remove mailbox sync jobs");
      }

      return { ok: true as const };
    },
  );
};
