import {
  canViewMeeting,
  meetingDigestResponseSchema,
  meetingIdParamsSchema,
  meetingOutcomePatchSchema,
  meetingSchema,
  yesterdayBoundsUtc,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { meetings, people } from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import { serializeMeeting, serializePerson } from "../lib/serialize.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

export const meetingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/meetings/digest",
    {
      schema: {
        response: { 200: meetingDigestResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      if (!canViewMeeting()) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }

      const { start, end } = yesterdayBoundsUtc(new Date());
      const rows = await app.db
        .select({ meeting: meetings, person: people })
        .from(meetings)
        .innerJoin(people, eq(meetings.personId, people.id))
        .where(
          and(
            eq(meetings.outcome, "scheduled"),
            gte(meetings.scheduledAt, start),
            lt(meetings.scheduledAt, end),
            isNull(people.deletedAt),
          ),
        )
        .orderBy(asc(meetings.scheduledAt));

      return meetingDigestResponseSchema.parse({
        data: rows.map((row) => {
          const person = serializePerson(row.person);
          return {
            meeting: serializeMeeting(row.meeting),
            person: {
              id: person.id,
              firstName: person.firstName,
              lastName: person.lastName,
              email: person.email,
            },
          };
        }),
      });
    },
  );

  app.patch(
    "/meetings/:id",
    {
      schema: {
        params: meetingIdParamsSchema,
        body: meetingOutcomePatchSchema,
        response: { 200: meetingSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      const rows = await app.db
        .select()
        .from(meetings)
        .where(eq(meetings.id, req.params.id))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw httpError(404, "NOT_FOUND", "Meeting not found");
      }

      if (row.outcome === req.body.outcome && !row.needsReview) {
        return meetingSchema.parse(serializeMeeting(row));
      }

      const [updated] = await app.db
        .update(meetings)
        .set({
          outcome: req.body.outcome,
          needsReview: false,
        })
        .where(eq(meetings.id, row.id))
        .returning();
      if (!updated) {
        throw httpError(404, "NOT_FOUND", "Meeting not found");
      }

      const when = new Date();
      await writeActivity(app.db, {
        personId: row.personId,
        userId: actor.id,
        type: "meeting",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "meeting.outcome",
          when: when.toISOString(),
          before: { outcome: row.outcome, needsReview: row.needsReview },
          after: { outcome: req.body.outcome, needsReview: false },
        },
      });

      return meetingSchema.parse(serializeMeeting(updated));
    },
  );
};
