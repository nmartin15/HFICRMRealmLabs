import cookie from "@fastify/cookie";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import Fastify from "fastify";
import { getTableName } from "drizzle-orm";
import { yesterdayBoundsUtc } from "@realm-labs/contracts";
import { describe, expect, it } from "vitest";
import { meetings, tasks } from "@realm-labs/db";
import errorPlugin from "../plugins/error.js";
import { meetingRoutes } from "./meetings.js";

const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";

const { start } = yesterdayBoundsUtc(new Date());
const dueAt = new Date(start.getTime() + 60 * 60 * 1000);

const person = {
  id: PERSON_ID,
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
};

const taskRow = {
  id: TASK_ID,
  personId: PERSON_ID,
  kind: "meeting" as const,
  dueAt,
  notes: null,
  status: "open" as const,
  calendarEventId: "evt-1",
  outcome: "scheduled" as const,
  needsReview: false,
  createdBy: ACTOR_ID,
  createdAt: dueAt,
  updatedAt: dueAt,
};

function thenableRows(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    limit: async () => rows,
    orderBy: async () => rows,
  });
}

function digestDb() {
  return {
    select: () => ({
      from: (table: typeof meetings | typeof tasks) => ({
        innerJoin: () => ({
          where: () =>
            thenableRows(
              getTableName(table) === "tasks"
                ? [{ task: taskRow, person }]
                : [],
            ),
        }),
      }),
    }),
  };
}

function patchTaskDb() {
  return {
    select: () => ({
      from: (table: typeof meetings | typeof tasks) => ({
        where: () => ({
          limit: async () =>
            getTableName(table) === "tasks" ? [taskRow] : [],
        }),
      }),
    }),
    update: (table: typeof meetings | typeof tasks) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (getTableName(table) !== "tasks") {
              throw new Error("calendar meetings live on tasks");
            }
            return [{ ...taskRow, ...values }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: "act-1" }],
      }),
    }),
  };
}

async function buildMeetingsApp(db: unknown) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("db", db as never);
  app.decorate("queues", {
    score: {
      getJob: async () => null,
      add: async () => undefined,
    },
  } as never);
  await app.register(cookie, { secret: "x".repeat(32) });
  await app.register(errorPlugin);
  app.addHook("preHandler", async (req) => {
    req.user = {
      id: ACTOR_ID,
      email: "nathan@realmlabs.co",
      name: "Nathan",
      googleSub: null,
      role: "admin",
    };
  });
  await app.register(meetingRoutes, { prefix: "/api" });
  return app;
}

describe("meetings digest and outcome", () => {
  it("digest includes calendar meeting tasks when the meetings table is empty", async () => {
    const app = await buildMeetingsApp(digestDb());
    const res = await app.inject({
      method: "GET",
      url: "/api/meetings/digest",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([
      {
        meeting: {
          id: TASK_ID,
          personId: PERSON_ID,
          scheduledAt: dueAt.toISOString(),
          calendarEventId: "evt-1",
          outcome: "scheduled",
          needsReview: false,
          notes: null,
          createdBy: ACTOR_ID,
          createdAt: dueAt.toISOString(),
          updatedAt: dueAt.toISOString(),
        },
        person,
      },
    ]);
    await app.close();
  });

  it("PATCH updates a calendar meeting task when the meetings table has no row", async () => {
    const app = await buildMeetingsApp(patchTaskDb());
    const res = await app.inject({
      method: "PATCH",
      url: `/api/meetings/${TASK_ID}`,
      payload: { outcome: "no_show" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().outcome).toBe("no_show");
    expect(res.json().id).toBe(TASK_ID);
    await app.close();
  });
});
