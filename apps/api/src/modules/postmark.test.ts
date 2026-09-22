import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import errorPlugin from "../plugins/error.js";
import { postmarkRoutes } from "./postmark.js";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const WRITE_ERROR = "unsubscribe write is not allowed on this db";

function readOnlyDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            { toEmail: "ada@example.com", personId: null },
          ],
        }),
        innerJoin: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    }),
    insert: () => {
      throw new Error(WRITE_ERROR);
    },
    update: () => {
      throw new Error(WRITE_ERROR);
    },
    delete: () => {
      throw new Error(WRITE_ERROR);
    },
    transaction: () => {
      throw new Error(WRITE_ERROR);
    },
  };
}

async function buildUnsubscribeApp() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("db", readOnlyDb() as never);
  app.decorate("env", {
    EMAIL_HASH_KEY: "ab".repeat(32),
    POSTMARK_WEBHOOK_USER: "hook",
    POSTMARK_WEBHOOK_PASSWORD: "secret",
  } as never);
  await app.register(errorPlugin);
  await app.register(postmarkRoutes, { prefix: "/api" });
  return app;
}

describe("unsubscribe HTTP methods", () => {
  it("GET renders a confirmation form and does not write suppression", async () => {
    const app = await buildUnsubscribeApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/unsubscribe/${TOKEN}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain('method="post"');
    expect(res.body).toContain("<button type=\"submit\" autofocus>Unsubscribe</button>");
    expect(res.body).not.toContain("You will not get further email");
    await app.close();
  });

  it("POST writes suppression (fails closed on a read-only db)", async () => {
    const app = await buildUnsubscribeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/unsubscribe/${TOKEN}`,
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toEqual({
      code: "INTERNAL",
      message: "Unexpected error",
    });
    await app.close();
  });
});
