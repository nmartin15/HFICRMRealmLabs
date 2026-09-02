import {
  ALLOCATION_STAGE_LABELS,
  buildHomeTodos,
  canViewCard,
  canViewMeeting,
  emailThreadSchema,
  homeCounts,
  homeSnapshotResponseSchema,
  isIncubatorWaitingStage,
  meetingDigestPersonSchema,
  todayBoundsUtc,
  zonedIsoDate,
  type HomeCallInput,
  type HomeDecisionInput,
  type HomeIncubatorInput,
  type HomeOpenTaskInput,
  type HomePersonInput,
  type HomeScheduleItem,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  allocationCards,
  emailThreads,
  incubatorCards,
  people,
  tasks,
} from "@realm-labs/db";
import {
  emailThreadRowVisible,
  emailThreadsVisibleSql,
  loadPersonalMailboxOwner,
} from "../lib/email-visibility.js";
import {
  serializeEmailThread,
  serializePerson,
  serializeTask,
} from "../lib/serialize.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

function digestPerson(person: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}) {
  return meetingDigestPersonSchema.parse({
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    email: person.email,
  });
}

function toScheduleItem(row: {
  task: typeof tasks.$inferSelect;
  person: typeof people.$inferSelect;
}): HomeScheduleItem {
  return {
    task: serializeTask(row.task),
    person: digestPerson(serializePerson(row.person)),
  };
}

export const homeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/home",
    {
      schema: {
        response: { 200: homeSnapshotResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      if (!canViewMeeting() || !canViewCard()) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }

      const now = new Date();
      const todayYmd = zonedIsoDate(now);
      const today = todayBoundsUtc(now);
      const owner = await loadPersonalMailboxOwner(app.db);
      const visibility = emailThreadsVisibleSql(user, owner) ?? sql`true`;
      const listed = and(
        isNull(people.deletedAt),
        eq(people.doNotContact, false),
      );

      const [
        leftoverRows,
        todayMeetingRows,
        unmatchedRows,
        todayEmailRows,
        allocationRows,
        incubatorRows,
        upcomingMeetingRows,
        openTaskRows,
        needsTrackRows,
        needsReviewRows,
      ] = await Promise.all([
        app.db
          .select({ task: tasks, person: people })
          .from(tasks)
          .innerJoin(people, eq(tasks.personId, people.id))
          .where(
            and(
              eq(tasks.kind, "meeting"),
              eq(tasks.status, "open"),
              listed,
              or(lt(tasks.dueAt, today.start), eq(tasks.needsReview, true)),
            ),
          )
          .orderBy(asc(tasks.dueAt)),
        app.db
          .select({ task: tasks, person: people })
          .from(tasks)
          .innerJoin(people, eq(tasks.personId, people.id))
          .where(
            and(
              eq(tasks.kind, "meeting"),
              eq(tasks.status, "open"),
              gte(tasks.dueAt, today.start),
              lt(tasks.dueAt, today.end),
              listed,
            ),
          )
          .orderBy(asc(tasks.dueAt)),
        app.db
          .select()
          .from(emailThreads)
          .where(
            and(
              eq(emailThreads.mailbox, "shared"),
              isNull(emailThreads.personId),
            ),
          )
          .orderBy(desc(emailThreads.lastMessageAt)),
        app.db
          .select({ thread: emailThreads, person: people })
          .from(emailThreads)
          .leftJoin(people, eq(emailThreads.personId, people.id))
          .where(
            and(
              visibility,
              gte(emailThreads.lastMessageAt, today.start),
              lt(emailThreads.lastMessageAt, today.end),
              or(
                isNull(emailThreads.personId),
                and(isNull(people.deletedAt), eq(people.doNotContact, false)),
              ),
            ),
          )
          .orderBy(desc(emailThreads.lastMessageAt)),
        app.db
          .select({ card: allocationCards, person: people })
          .from(allocationCards)
          .innerJoin(people, eq(allocationCards.personId, people.id))
          .where(
            and(
              listed,
              inArray(allocationCards.stage, [
                "contacted",
                "in_conversation",
                "decision",
              ]),
            ),
          ),
        app.db
          .select({ card: incubatorCards, person: people })
          .from(incubatorCards)
          .innerJoin(people, eq(incubatorCards.personId, people.id))
          .where(and(listed, inArray(incubatorCards.stage, ["applied"]))),
        app.db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.kind, "meeting"),
              eq(tasks.status, "open"),
              gte(tasks.dueAt, now),
            ),
          )
          .orderBy(asc(tasks.dueAt)),
        app.db
          .select({ task: tasks, person: people })
          .from(tasks)
          .innerJoin(people, eq(tasks.personId, people.id))
          .where(
            and(eq(tasks.status, "open"), lt(tasks.dueAt, today.end), listed),
          )
          .orderBy(asc(tasks.dueAt)),
        app.db
          .select({ person: people, incubatorStage: incubatorCards.stage })
          .from(people)
          .leftJoin(incubatorCards, eq(incubatorCards.personId, people.id))
          .where(
            and(listed, isNull(people.programTrack), or(
              isNull(incubatorCards.stage),
              ne(incubatorCards.stage, "rejected"),
            )),
          )
          .orderBy(asc(people.lastName), asc(people.firstName)),
        app.db
          .select()
          .from(people)
          .where(and(listed, eq(people.needsReview, true)))
          .orderBy(asc(people.lastName), asc(people.firstName)),
      ]);

      const leftoverMeetings: HomeScheduleItem[] = leftoverRows
        .filter(
          (row) =>
            row.task.dueAt.getTime() < today.start.getTime() ||
            row.task.needsReview,
        )
        .filter(
          (row) =>
            row.task.dueAt.getTime() < today.start.getTime() ||
            !todayMeetingRows.some((todayRow) => todayRow.task.id === row.task.id),
        )
        .map(toScheduleItem);

      const todayMeetings: HomeScheduleItem[] = todayMeetingRows.map(toScheduleItem);

      const skipCallPersonIds = new Set<string>();
      for (const meeting of upcomingMeetingRows) {
        skipCallPersonIds.add(meeting.personId);
      }
      for (const item of leftoverMeetings) {
        skipCallPersonIds.add(item.person.id);
      }
      for (const item of todayMeetings) {
        skipCallPersonIds.add(item.person.id);
      }

      const closeTaskIds = new Set([
        ...leftoverMeetings.map((item) => item.task.id),
        ...todayMeetings
          .filter((item) => item.task.dueAt <= now.toISOString())
          .map((item) => item.task.id),
      ]);

      const openTasks: HomeOpenTaskInput[] = [];
      for (const row of openTaskRows) {
        if (row.task.kind === "call" || row.task.kind === "meeting") {
          skipCallPersonIds.add(row.person.id);
        }
        if (row.task.kind === "meeting" || closeTaskIds.has(row.task.id)) {
          continue;
        }
        openTasks.push({
          id: row.task.id,
          person: digestPerson(serializePerson(row.person)),
          kind: row.task.kind,
          dueAt: row.task.dueAt.toISOString(),
          notes: row.task.notes,
        });
      }

      const callsDue: HomeCallInput[] = [];
      const decisions: HomeDecisionInput[] = [];
      for (const row of allocationRows) {
        const person = digestPerson(serializePerson(row.person));
        if (row.card.stage === "decision") {
          decisions.push({ person });
          continue;
        }
        if (
          row.card.stage !== "contacted" &&
          row.card.stage !== "in_conversation"
        ) {
          continue;
        }
        if (row.card.stage === "contacted" && row.card.noCallAppLink) {
          continue;
        }
        if (skipCallPersonIds.has(row.person.id)) {
          continue;
        }
        callsDue.push({
          person,
          stageLabel: ALLOCATION_STAGE_LABELS[row.card.stage],
        });
      }

      const incubatorWaiting: HomeIncubatorInput[] = incubatorRows.flatMap(
        (row) => {
          if (!isIncubatorWaitingStage(row.card.stage)) {
            return [];
          }
          return [
            {
              person: digestPerson(serializePerson(row.person)),
              stage: row.card.stage,
            },
          ];
        },
      );

      const unmatchedEmails = unmatchedRows.map((row) => {
        const thread = emailThreadSchema.parse(serializeEmailThread(row));
        return {
          id: thread.id,
          subject: thread.subject,
          lastMessageAt: thread.lastMessageAt,
          snippet: thread.snippet,
        };
      });

      const needsTrack = needsTrackRows.map((row) =>
        digestPerson(serializePerson(row.person)),
      );
      const needsReview: HomePersonInput[] = needsReviewRows.map((row) => ({
        person: digestPerson(serializePerson(row)),
        firstName: row.firstName,
        lastName: row.lastName,
        needsReview: row.needsReview,
      }));

      const todos = buildHomeTodos({
        leftoverMeetings,
        todayMeetings,
        openTasks,
        unmatchedEmails,
        callsDue,
        decisions,
        incubatorWaiting,
        needsTrack,
        needsReview,
        now,
      });

      const emails = todayEmailRows
        .filter((row) => emailThreadRowVisible(row.thread, user, owner))
        .map((row) => ({
          thread: emailThreadSchema.parse(serializeEmailThread(row.thread)),
          person: row.person
            ? digestPerson(serializePerson(row.person))
            : null,
        }));

      return homeSnapshotResponseSchema.parse({
        date: todayYmd,
        todos,
        schedule: todayMeetings,
        emails,
        counts: homeCounts({
          todos,
          leftoverCount: leftoverMeetings.length,
          scheduleCount: todayMeetings.length,
          emailCount: emails.filter((item) => item.person !== null).length,
        }),
      });
    },
  );
};
