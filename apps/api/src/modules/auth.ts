import {
  authProvidersResponseSchema,
  googleCallbackQuerySchema,
  googleStartResponseSchema,
  isHostedDomainClaim,
  isHostedDomainEmail,
  meResponseSchema,
  normalizeEmail,
  okResponseSchema,
  userSchema,
} from "@realm-labs/contracts";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { users } from "@realm-labs/db";
import { googleConfigured } from "../env.js";
import {
  exchangeGoogleCode,
  googleLoginUrl,
  oauthErrorRedirect,
} from "../lib/google.js";
import { serializeUser } from "../lib/serialize.js";
import { clearSessionCookie, setSessionCookie } from "../plugins/auth.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

function randomState(): string {
  return Buffer.from(`${Date.now()}:${Math.random()}`).toString("base64url");
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/auth/providers",
    {
      schema: {
        response: { 200: authProvidersResponseSchema },
      },
    },
    async () => ({ google: googleConfigured(app.env) }),
  );

  app.post(
    "/auth/google",
    {
      schema: {
        response: { 200: googleStartResponseSchema },
      },
    },
    async (req, reply) => {
      if (!googleConfigured(app.env)) {
        throw httpError(
          503,
          "GOOGLE_NOT_CONFIGURED",
          "Google OAuth is not configured",
        );
      }

      const state = randomState();
      reply.setCookie("rl_oauth_state", state, {
        httpOnly: true,
        sameSite: "lax",
        secure: app.env.NODE_ENV === "production",
        path: "/",
        maxAge: 600,
      });

      return { url: googleLoginUrl(app.env, state) };
    },
  );

  app.get(
    "/auth/google/callback",
    {
      schema: {
        querystring: googleCallbackQuerySchema,
      },
    },
    async (req, reply) => {
      if (!googleConfigured(app.env)) {
      return reply.redirect(
        oauthErrorRedirect(
          app.env.WEB_ORIGIN,
          "GOOGLE_NOT_CONFIGURED",
          "Google OAuth is not configured",
        ),
      );
    }

    const query = req.query;
    if (query.error || !query.code) {
      return reply.redirect(
        oauthErrorRedirect(
          app.env.WEB_ORIGIN,
          "OAUTH_ERROR",
          query.error ?? "Missing authorization code",
        ),
      );
    }

    const expectedState = req.cookies.rl_oauth_state;
    if (!expectedState || !query.state || expectedState !== query.state) {
      return reply.redirect(
        oauthErrorRedirect(
          app.env.WEB_ORIGIN,
          "OAUTH_ERROR",
          "Invalid OAuth state",
        ),
      );
    }

    reply.clearCookie("rl_oauth_state", { path: "/" });

    try {
      const profile = await exchangeGoogleCode(app.env, query.code);
      const email = normalizeEmail(profile.email);

      if (!email || !profile.id) {
        return reply.redirect(
          oauthErrorRedirect(
            app.env.WEB_ORIGIN,
            "OAUTH_ERROR",
            "Google account has no email",
          ),
        );
      }

      if (
        !isHostedDomainEmail(email, app.env.ALLOWED_HOSTED_DOMAIN) ||
        !isHostedDomainClaim(profile.hd, app.env.ALLOWED_HOSTED_DOMAIN)
      ) {
        return reply.redirect(
          oauthErrorRedirect(
            app.env.WEB_ORIGIN,
            "DOMAIN_NOT_ALLOWED",
            `Sign-in is restricted to ${app.env.ALLOWED_HOSTED_DOMAIN} Google Workspace accounts`,
          ),
        );
      }

      const bySub = await app.db
        .select()
        .from(users)
        .where(eq(users.googleSub, profile.id))
        .limit(1);

      let user = bySub[0];

      if (!user) {
        const byEmail = await app.db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        user = byEmail[0];
      }

      const name = profile.name.trim() || email.split("@")[0] || email;

      if (!user) {
        const role = email === app.env.ADMIN_EMAIL ? "admin" : "member";
        const [created] = await app.db
          .insert(users)
          .values({
            email,
            name,
            googleSub: profile.id,
            role,
          })
          .returning();
        if (!created) {
          throw new Error("Failed to create user");
        }
        user = created;
      } else {
        const [updated] = await app.db
          .update(users)
          .set({
            email,
            name,
            googleSub: profile.id,
          })
          .where(eq(users.id, user.id))
          .returning();
        if (!updated) {
          throw new Error("Failed to update user");
        }
        user = updated;
      }

      setSessionCookie(reply, user.id, app.env.NODE_ENV === "production");
      return reply.redirect(`${app.env.WEB_ORIGIN.replace(/\/$/, "")}/settings`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google sign-in failed";
      return reply.redirect(
        oauthErrorRedirect(app.env.WEB_ORIGIN, "OAUTH_ERROR", message),
      );
    }
  });

  app.post(
    "/auth/logout",
    {
      schema: {
        response: { 200: okResponseSchema },
      },
    },
    async (_req, reply) => {
      clearSessionCookie(reply);
      return { ok: true as const };
    },
  );

  app.get(
    "/me",
    {
      schema: {
        response: { 200: meResponseSchema },
      },
    },
    async (req) => {
      const session = requireUser(req);
      const rows = await app.db
        .select()
        .from(users)
        .where(eq(users.id, session.id))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw httpError(401, "UNAUTHORIZED", "Unauthorized");
      }
      return userSchema.parse(serializeUser(row));
    },
  );
};
