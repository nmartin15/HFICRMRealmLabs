import {
  canViewMeeting,
  meetingDigestResponseSchema,
  meetingIdParamsSchema,
  meetingOutcomePatchSchema,
  meetingSchema,
  yesterdayBoundsUtc,
  type Meeting,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, asc, eq, gte, isNull, lt, or } from "drizzle-orm";
import { meetings, people, tasks, type Database } from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import { enqueuePersonScore } from "../lib/score-enqueue.js";
import type { SyncQueues } from "../lib/queues.js";
import {
  serializeMeeting,
  serializeMeetingFromTask,
} from "../lib/serialize.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

function digestPerson(person: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}) {
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    email: person.email,
  };
}

function mergeDigestMeetings(
  fromMeetings: { meeting: Meeting; person: ReturnType<typeof digestPerson> }[],
  fromTasks: { meeting: Meeting; person: ReturnType<typeof digestPerson> }[],
) {
  const seen = new Set<string>();
  const merged = [];
  for (const item of [...fromMeetings, ...fromTasks]) {
    const key = item.meeting.calendarEventId ?? item.meeting.id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  merged.sort((a, b) =>
    a.meeting.scheduledAt.localeCompare(b.meeting.scheduledAt),
  );
  return merged;
}

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
      const meetingRows = await app.db
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

      const taskRows = await app.db
        .select({ task: tasks, person: people })
        .from(tasks)
        .innerJoin(people, eq(tasks.personId, people.id))
        .where(
          and(
            eq(tasks.kind, "meeting"),
            or(eq(tasks.outcome, "scheduled"), isNull(tasks.outcome)),
            gte(tasks.dueAt, start),
            lt(tasks.dueAt, end),
            isNull(people.deletedAt),
          ),
        )
        .orderBy(asc(tasks.dueAt));

      return meetingDigestResponseSchema.parse({
        data: mergeDigestMeetings(
          meetingRows.map((row) => ({
            meeting: serializeMeeting(row.meeting),
            person: digestPerson(row.person),
          })),
          taskRows.map((row) => ({
            meeting: serializeMeetingFromTask(row.task),
            person: digestPerson(row.person),
          })),
        ),
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
      const meetingRows = await app.db
        .select()
        .from(meetings)
        .where(eq(meetings.id, req.params.id))
        .limit(1);
      const meetingRow = meetingRows[0];
      if (meetingRow) {
        if (meetingRow.outcome === req.body.outcome && !meetingRow.needsReview) {
          return meetingSchema.parse(serializeMeeting(meetingRow));
        }

        const [updated] = await app.db
          .update(meetings)
          .set({
            outcome: req.body.outcome,
            needsReview: false,
          })
          .where(eq(meetings.id, meetingRow.id))
          .returning();
        if (!updated) {
          throw httpError(404, "NOT_FOUND", "Meeting not found");
        }

        await recordMeetingOutcome(app.db, app.queues, {
          personId: meetingRow.personId,
          actor,
          before: {
            outcome: meetingRow.outcome,
            needsReview: meetingRow.needsReview,
          },
          outcome: req.body.outcome,
        });
        return meetingSchema.parse(serializeMeeting(updated));
      }

      const taskRows = await app.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, req.params.id), eq(tasks.kind, "meeting")))
        .limit(1);
      const taskRow = taskRows[0];
      if (!taskRow) {
        throw httpError(404, "NOT_FOUND", "Meeting not found");
      }

      const currentOutcome = taskRow.outcome ?? "scheduled";
      if (currentOutcome === req.body.outcome && !taskRow.needsReview) {
        return meetingSchema.parse(serializeMeetingFromTask(taskRow));
      }

      const [updatedTask] = await app.db
        .update(tasks)
        .set({
          outcome: req.body.outcome,
          needsReview: false,
          status:
            req.body.outcome === "rescheduled" ? "rescheduled" : "done",
        })
        .where(eq(tasks.id, taskRow.id))
        .returning();
      if (!updatedTask) {
        throw httpError(404, "NOT_FOUND", "Meeting not found");
      }

      await recordMeetingOutcome(app.db, app.queues, {
        personId: taskRow.personId,
        actor,
        before: {
          outcome: currentOutcome,
          needsReview: taskRow.needsReview,
        },
        outcome: req.body.outcome,
      });
      return meetingSchema.parse(serializeMeetingFromTask(updatedTask));
    },
  );
};

async function recordMeetingOutcome(
  db: Database,
  queues: SyncQueues,
  input: {
    personId: string;
    actor: { id: string; email: string };
    before: { outcome: string; needsReview: boolean };
    outcome: "held" | "no_show" | "rescheduled";
  },
): Promise<void> {
  const when = new Date();
  await writeActivity(db, {
    personId: input.personId,
    userId: input.actor.id,
    type: "meeting",
    payload: {
      who: { id: input.actor.id, email: input.actor.email },
      what: "meeting.outcome",
      when: when.toISOString(),
      before: input.before,
      after: { outcome: input.outcome, needsReview: false },
    },
  });

  if (input.outcome === "held") {
    await enqueuePersonScore(queues, {
      personId: input.personId,
      trigger: "meeting_held",
      computedBy: input.actor.id,
    });
  } else if (input.outcome === "no_show") {
    await enqueuePersonScore(queues, {
      personId: input.personId,
      trigger: "no_show",
      computedBy: input.actor.id,
    });
  }
}
