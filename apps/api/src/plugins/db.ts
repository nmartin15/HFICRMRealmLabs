import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { createDb, type Database } from "@realm-labs/db";
import type { Env } from "../env.js";
import {
  closeSyncQueues,
  createSyncQueues,
  type SyncQueues,
} from "../lib/queues.js";
import type { AuthedUser } from "./auth.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    env: Env;
    queues: SyncQueues;
  }

  interface FastifyRequest {
    user?: AuthedUser;
    rawBody?: string;
  }
}

const dbPlugin: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  const { db, client } = createDb(opts.env.DATABASE_URL);
  const queues = createSyncQueues(opts.env.REDIS_URL);
  app.decorate("db", db);
  app.decorate("env", opts.env);
  app.decorate("queues", queues);
  app.addHook("onClose", async () => {
    await closeSyncQueues(queues);
    await client.end({ timeout: 5 });
  });
};

export default fp(dbPlugin);

export function requireUser(req: FastifyRequest): AuthedUser {
  if (!req.user) {
    throw Object.assign(new Error("Unauthorized"), {
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  }
  return req.user;
}

export function requireAdmin(req: FastifyRequest): AuthedUser {
  const user = requireUser(req);
  if (user.role !== "admin") {
    throw Object.assign(new Error("Only admin can perform this action"), {
      statusCode: 403,
      code: "FORBIDDEN",
    });
  }
  return user;
}
