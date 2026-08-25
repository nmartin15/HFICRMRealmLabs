import {
  canViewEmailThread,
  emailThreadIdParamsSchema,
  emailThreadListResponseSchema,
  emailThreadSchema,
  linkEmailThreadBodySchema,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { emailThreads, people } from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import { emailThreadsVisibleSql } from "../lib/email-visibility.js";
import { serializeEmailThread } from "../lib/serialize.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

export const emailThreadRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/email-threads",
    {
      schema: {
        response: { 200: emailThreadListResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const visibility = emailThreadsVisibleSql(user.email) ?? sql`true`;

      const rows = await app.db
        .select({ thread: emailThreads, person: people })
        .from(emailThreads)
        .leftJoin(people, eq(emailThreads.personId, people.id))
        .where(
          and(
            visibility,
            or(isNull(emailThreads.personId), eq(people.doNotContact, false)),
          ),
        )
        .orderBy(desc(emailThreads.lastMessageAt));

      const visible = rows
        .map((row) => row.thread)
        .filter((row) =>
          canViewEmailThread({
            mailbox: row.mailbox,
            sharedVisible: row.sharedVisible,
            viewerEmail: user.email,
          }),
        );

      return {
        data: visible.map((row) =>
          emailThreadSchema.parse(serializeEmailThread(row)),
        ),
      };
    },
  );

  app.get(
    "/email-threads/unmatched",
    {
      schema: {
        response: { 200: emailThreadListResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      const rows = await app.db
        .select()
        .from(emailThreads)
        .where(
          and(
            eq(emailThreads.mailbox, "shared"),
            isNull(emailThreads.personId),
          ),
        )
        .orderBy(desc(emailThreads.lastMessageAt));

      return {
        data: rows.map((row) =>
          emailThreadSchema.parse(serializeEmailThread(row)),
        ),
      };
    },
  );

  app.patch(
    "/email-threads/:id",
    {
      schema: {
        params: emailThreadIdParamsSchema,
        body: linkEmailThreadBodySchema,
        response: { 200: emailThreadSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      const threadRows = await app.db
        .select()
        .from(emailThreads)
        .where(eq(emailThreads.id, req.params.id))
        .limit(1);
      const thread = threadRows[0];
      if (!thread) {
        throw httpError(404, "NOT_FOUND", "Email thread not found");
      }
      if (thread.mailbox !== "shared") {
        throw httpError(
          400,
          "INVALID_THREAD",
          "Only shared mailbox threads can be linked from Unmatched",
        );
      }
      if (thread.personId) {
        throw httpError(400, "ALREADY_LINKED", "Thread is already linked");
      }

      const personRows = await app.db
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.id, req.body.personId), isNull(people.deletedAt)))
        .limit(1);
      if (!personRows[0]) {
        throw httpError(400, "INVALID_PERSON", "Person not found");
      }

      const [updated] = await app.db
        .update(emailThreads)
        .set({ personId: req.body.personId })
        .where(eq(emailThreads.id, thread.id))
        .returning();
      if (!updated) {
        throw httpError(404, "NOT_FOUND", "Email thread not found");
      }

      const when = new Date();
      await writeActivity(app.db, {
        personId: req.body.personId,
        userId: actor.id,
        type: "email",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "email.thread_linked",
          when: when.toISOString(),
          before: { personId: null },
          after: {
            personId: req.body.personId,
            threadId: thread.id,
            subject: thread.subject,
            snippet: thread.snippet,
          },
        },
      });

      return emailThreadSchema.parse(serializeEmailThread(updated));
    },
  );
};
