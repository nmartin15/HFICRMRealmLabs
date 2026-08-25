import type { UserRole } from "@realm-labs/contracts";
import { sessionCookieName } from "@realm-labs/contracts";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { users } from "@realm-labs/db";
import { httpError } from "./error.js";

export type AuthedUser = {
  id: string;
  email: string;
  name: string;
  googleSub: string | null;
  role: UserRole;
};

const PUBLIC_API_PATHS = new Set([
  "/api/auth/providers",
  "/api/auth/google",
  "/api/auth/google/callback",
]);

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function requestPath(req: FastifyRequest): string {
  return req.url.split("?")[0] ?? req.url;
}

async function loadUser(req: FastifyRequest): Promise<void> {
  const raw = req.cookies[sessionCookieName];
  if (!raw) {
    return;
  }

  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) {
    return;
  }

  const rows = await req.server.db
    .select()
    .from(users)
    .where(eq(users.id, unsigned.value))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return;
  }

  req.user = {
    id: row.id,
    email: row.email,
    name: row.name,
    googleSub: row.googleSub,
    role: row.role,
  };
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("user", undefined);

  app.addHook("preHandler", async (req) => {
    const path = requestPath(req);
    if (!path.startsWith("/api")) {
      return;
    }

    await loadUser(req);

    if (PUBLIC_API_PATHS.has(path) || path.startsWith("/api/webhooks/")) {
      return;
    }

    if (!req.user) {
      throw httpError(401, "UNAUTHORIZED", "Unauthorized");
    }
  });
};

export default fp(authPlugin);

export function setSessionCookie(
  reply: FastifyReply,
  userId: string,
  isProduction: boolean,
): void {
  reply.setCookie(sessionCookieName, userId, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(sessionCookieName, { path: "/" });
}
