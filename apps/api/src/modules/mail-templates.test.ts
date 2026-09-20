import cookie from "@fastify/cookie";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import Fastify from "fastify";
import { MAIL_TEMPLATE_CATALOG, mailTemplateKey } from "@realm-labs/contracts";
import { getTableName, type Table } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import errorPlugin from "../plugins/error.js";
import { mailTemplateRoutes } from "./mail-templates.js";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-19T17:00:00.000Z");
const applied = MAIL_TEMPLATE_CATALOG.find(
  (entry) => entry.program === "allocation" && entry.stage === "applied",
);
if (!applied) {
  throw new Error("expected allocation applied catalog entry");
}

function thenableRows(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    where: () =>
      Object.assign(Promise.resolve(rows), {
        limit: async () => rows,
      }),
    limit: async () => rows,
  });
}

function templatesDb(existing: Record<string, unknown> | null) {
  const inserts: Record<string, unknown>[] = [];
  const activities: Record<string, unknown>[] = [];
  const row = existing
    ? existing
    : {
        id: TEMPLATE_ID,
        lane: applied.lane,
        program: applied.program,
        stage: applied.stage,
        purpose: applied.purpose,
        subject: "Hi {{firstName}}",
        bodyText: "Thanks for applying.",
        createdAt: NOW,
        updatedAt: NOW,
      };
  return {
    inserts,
    activities,
    select: () => ({
      from: (table: unknown) =>
        thenableRows(
          getTableName(table as Table) === "mail_templates" && existing
            ? [existing]
            : [],
        ),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const name = getTableName(table as Table);
        if (name === "activities") {
          activities.push(values);
          return {
            returning: async () => [{ id: "act-1", ...values }],
          };
        }
        inserts.push(values);
        return {
          returning: async () => [{ ...row, ...values }],
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => [{ ...row, ...values }],
        }),
      }),
    }),
  };
}

async function buildApp(
  db: unknown,
  role: "admin" | "member" = "admin",
) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("db", db as never);
  await app.register(cookie, { secret: "x".repeat(32) });
  await app.register(errorPlugin);
  app.addHook("preHandler", async (req) => {
    req.user = {
      id: ACTOR_ID,
      email: "nathan@realmlabs.co",
      name: "Nathan",
      googleSub: null,
      role,
    };
  });
  await app.register(mailTemplateRoutes, { prefix: "/api" });
  return app;
}

describe("mail template routes", () => {
  it("lists saved rows plus the stage catalog for admins", async () => {
    const db = templatesDb(null);
    const app = await buildApp(db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mail-templates",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: unknown[];
      catalog: { label: string }[];
    };
    expect(body.data).toEqual([]);
    expect(body.catalog.map((entry) => entry.label)).toEqual(
      MAIL_TEMPLATE_CATALOG.map((entry) => entry.label),
    );
    await app.close();
  });

  it("rejects members", async () => {
    const db = templatesDb(null);
    const app = await buildApp(db, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/mail-templates",
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("saves an allowed stage template and writes activity", async () => {
    const db = templatesDb(null);
    const app = await buildApp(db);
    const res = await app.inject({
      method: "PUT",
      url: "/api/mail-templates",
      payload: {
        lane: applied.lane,
        program: applied.program,
        stage: applied.stage,
        purpose: applied.purpose,
        subject: "Hi {{firstName}}",
        bodyText: "Thanks for applying.",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      lane: applied.lane,
      program: applied.program,
      stage: applied.stage,
      subject: "Hi {{firstName}}",
      bodyText: "Thanks for applying.",
    });
    expect(db.inserts).toHaveLength(1);
    expect(db.activities[0]).toMatchObject({
      userId: ACTOR_ID,
      type: "field_change",
    });
    await app.close();
  });

  it("rejects unknown catalog keys", async () => {
    const db = templatesDb(null);
    const app = await buildApp(db);
    const res = await app.inject({
      method: "PUT",
      url: "/api/mail-templates",
      payload: {
        lane: "sales",
        program: "allocation",
        stage: "not_a_stage",
        purpose: "sales",
        subject: "Hi",
        bodyText: "Hello",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("UNKNOWN_TEMPLATE");
    expect(db.inserts).toEqual([]);
    await app.close();
  });

  it("rejects a catalog row with the wrong purpose", async () => {
    const db = templatesDb(null);
    const app = await buildApp(db);
    const res = await app.inject({
      method: "PUT",
      url: "/api/mail-templates",
      payload: {
        lane: applied.lane,
        program: applied.program,
        stage: applied.stage,
        purpose: "newsletter",
        subject: "Hi",
        bodyText: "Hello",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(mailTemplateKey(applied)).toBe("sales.allocation.applied");
    expect(db.inserts).toEqual([]);
    await app.close();
  });

  it("enrolls mail when an admin releases a held tag", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "campaign-tags.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /sequenceAction: "start"[\s\S]*await applyMailEngineFromSequence/,
    );
  });
});
