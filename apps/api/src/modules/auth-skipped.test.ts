import cookie from "@fastify/cookie";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { campaignTagRoutes } from "./campaign-tags.js";
import { postmarkRoutes } from "./postmark.js";
import { scoringRoutes } from "./scoring.js";
import authPlugin from "../plugins/auth.js";
import errorPlugin from "../plugins/error.js";

async function buildSkippedAuthApp() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("db", {} as never);
  app.decorate("env", {
    CAMPAIGN_SYNC_SECRET: "campaign-sync-secret",
    POSTMARK_WEBHOOK_USER: "hook",
    POSTMARK_WEBHOOK_PASSWORD: "secret",
    EMAIL_HASH_KEY: "ab".repeat(32),
  } as never);
  await app.register(cookie, { secret: "x".repeat(32) });
  await app.register(errorPlugin);
  await app.register(authPlugin);
  await app.register(campaignTagRoutes, { prefix: "/api" });
  await app.register(postmarkRoutes, { prefix: "/api" });
  await app.register(scoringRoutes, { prefix: "/api" });
  return app;
}

describe("skipped-path credentials", () => {
  it("GET /campaign-tags without bearer is 401 even though the session plugin skips the path", async () => {
    const app = await buildSkippedAuthApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/campaign-tags",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /sends without bearer is 401 even with a valid body", async () => {
    const app = await buildSkippedAuthApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/sends",
      payload: {
        to: "ada@example.com",
        purpose: "sales",
        subject: "Hi",
        bodyText: "Hello",
      },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /webhooks/postmark without basic auth is 401", async () => {
    const app = await buildSkippedAuthApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/postmark",
      payload: { RecordType: "Delivery", Email: "ada@example.com" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /scoring/config without a session is 401", async () => {
    const app = await buildSkippedAuthApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/scoring/config",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
