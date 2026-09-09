import {
  CONFIGURED_MAILBOXES,
  canConnectMailbox,
  isConfiguredMailbox,
  googleCallbackQuerySchema,
  googleStartResponseSchema,
  mailboxConnectionListResponseSchema,
  mailboxEmailFor,
  mailboxParamsSchema,
  okResponseSchema,
  type Mailbox,
  type MailboxConnection,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { mailboxConnections } from "@realm-labs/db";
import { eq } from "drizzle-orm";
import { googleConfigured } from "../env.js";
import {
  googleMailboxUrl,
  mailboxOauthErrorRedirect,
  mailboxOauthSuccessRedirect,
} from "../lib/google.js";
import {
  MAILBOX_OAUTH_COOKIE,
  completeMailboxOAuth,
  decodeMailboxState,
  encodeMailboxState,
} from "../lib/mailbox-oauth.js";
import { removeMailboxSync } from "../lib/queues.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

function assertCanManageMailbox(
  actor: { role: "admin" | "member"; email: string },
  mailbox: Mailbox,
): void {
  if (
    !canConnectMailbox({
      role: actor.role,
      actorEmail: actor.email,
      mailboxEmail: mailboxEmailFor(mailbox),
    })
  ) {
    throw httpError(403, "FORBIDDEN", "You cannot manage this mailbox");
  }
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
      if (!isConfiguredMailbox(req.params.mailbox)) {
        throw httpError(404, "NOT_FOUND", "Mailbox is not in use");
      }
      const actor = requireUser(req);
      assertCanManageMailbox(actor, req.params.mailbox);
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
      if (!actor) {
        return reply.redirect(
          mailboxOauthErrorRedirect(
            app.env.WEB_ORIGIN,
            "FORBIDDEN",
            "You cannot connect this mailbox",
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

      const result = await completeMailboxOAuth({
        db: app.db,
        env: app.env,
        queues: app.queues,
        actor,
        mailbox,
        code: query.code,
        onEnqueueError: (err) => {
          req.log.error({ err }, "failed to enqueue mailbox sync");
        },
      });
      if (!result.ok) {
        return reply.redirect(
          mailboxOauthErrorRedirect(
            app.env.WEB_ORIGIN,
            result.code,
            result.message,
          ),
        );
      }
      return reply.redirect(mailboxOauthSuccessRedirect(app.env.WEB_ORIGIN));
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
      if (!isConfiguredMailbox(req.params.mailbox)) {
        throw httpError(404, "NOT_FOUND", "Mailbox is not in use");
      }
      const actor = requireUser(req);
      assertCanManageMailbox(actor, req.params.mailbox);

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
