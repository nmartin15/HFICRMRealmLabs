import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import { healthResponseSchema } from "@realm-labs/contracts";
import Fastify from "fastify";
import type { Env } from "./env.js";
import { allocationRoutes } from "./modules/allocation.js";
import { authRoutes } from "./modules/auth.js";
import { emailThreadRoutes } from "./modules/email-threads.js";
import { homeRoutes } from "./modules/home.js";
import { importRoutes } from "./modules/import.js";
import { incubatorRoutes } from "./modules/incubator.js";
import { mailboxRoutes } from "./modules/mailboxes.js";
import { meetingRoutes } from "./modules/meetings.js";
import { peopleRoutes } from "./modules/people.js";
import { reportInputRoutes } from "./modules/report-inputs.js";
import { reportRoutes } from "./modules/reports.js";
import { userRoutes } from "./modules/users.js";
import { webhookRoutes } from "./modules/webhooks.js";
import authPlugin from "./plugins/auth.js";
import dbPlugin from "./plugins/db.js";
import errorPlugin from "./plugins/error.js";

export async function buildApp(env: Env) {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
    trustProxy: env.NODE_ENV === "production",
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      const raw = typeof body === "string" ? body : body.toString("utf8");
      req.rawBody = raw;
      if (raw.length === 0) {
        done(null, null);
        return;
      }
      try {
        done(null, JSON.parse(raw) as unknown);
      } catch {
        const err = Object.assign(new Error("Invalid JSON"), {
          statusCode: 400,
          code: "INVALID_JSON",
        });
        done(err, undefined);
      }
    },
  );

  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  await app.register(cookie, {
    secret: env.SESSION_SECRET,
    hook: "onRequest",
  });

  await app.register(errorPlugin);
  await app.register(dbPlugin, { env });
  await app.register(authPlugin);

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  await app.register(authRoutes, { prefix: "/api" });
  await app.register(userRoutes, { prefix: "/api" });
  await app.register(peopleRoutes, { prefix: "/api" });
  await app.register(homeRoutes, { prefix: "/api" });
  await app.register(importRoutes, { prefix: "/api" });
  await app.register(allocationRoutes, { prefix: "/api" });
  await app.register(incubatorRoutes, { prefix: "/api" });
  await app.register(emailThreadRoutes, { prefix: "/api" });
  await app.register(meetingRoutes, { prefix: "/api" });
  await app.register(reportInputRoutes, { prefix: "/api" });
  await app.register(reportRoutes, { prefix: "/api" });
  await app.register(mailboxRoutes, { prefix: "/api" });
  await app.register(webhookRoutes, { prefix: "/api" });

  return app;
}
