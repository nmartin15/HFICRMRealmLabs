import {
  ALLOCATION_STAGE_LABELS,
  buildHomeTodos,
  canViewCard,
  canViewMeeting,
  canViewOperatorTask,
  emailThreadSchema,
  homeCounts,
  homeSnapshotResponseSchema,
  isIncubatorWaitingStage,
  isOpenMeetingSupersededByLaterOutcome,
  isWithinUtcBounds,
  latestHandSetMeetingDueAt,
  meetingDigestPersonSchema,
  operatorTasksQuerySchema,
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
  personCampaignTags,
  tasks,
} from "@realm-labs/db";
import { loadHomeDeliverability } from "../lib/deliverability.js";
import {
  emailThreadRowVisible,
  emailThreadsVisibleSql,
  loadMailboxOwners,
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
        querystring: operatorTasksQuerySchema,
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
      const owners = await loadMailboxOwners(app.db);
      const visibility = emailThreadsVisibleSql(user, owners) ?? sql`true`;
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
        campaignReviewRows,
        deliverability,
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
          .where(and(visibility, isNull(emailThreads.personId)))
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
            and(eq(tasks.status, "open"), listed),
          )
          .orderBy(asc(tasks.dueAt)),
        app.db
          .select({ person: people, incubatorStage: incubatorCards.stage })
          .from(people)
          .leftJoin(incubatorCards, eq(incubatorCards.personId, people.id))
          .where(
            and(
              listed,
              eq(people.contactKind, "contact"),
              isNull(people.programTrack),
              or(
                isNull(incubatorCards.stage),
                ne(incubatorCards.stage, "rejected"),
              ),
            ),
          )
          .orderBy(asc(people.lastName), asc(people.firstName)),
        app.db
          .select()
          .from(people)
          .where(and(listed, eq(people.needsReview, true)))
          .orderBy(asc(people.lastName), asc(people.firstName)),
        app.db
          .select({ person: people })
          .from(personCampaignTags)
          .innerJoin(people, eq(personCampaignTags.personId, people.id))
          .where(
            and(
              listed,
              eq(people.contactKind, "contact"),
              eq(personCampaignTags.sequenceAction, "pending_review"),
            ),
          )
          .orderBy(asc(people.lastName), asc(people.firstName)),
        loadHomeDeliverability(app.db, now),
      ]);

      const includeAllOperators =
        user.role === "admin" && req.query.operators === "all";
      const visibleTask = (createdBy: string) =>
        canViewOperatorTask({
          role: user.role,
          viewerId: user.id,
          createdBy,
          includeAllOperators,
        });

      let leftoverMeetings: HomeScheduleItem[] = leftoverRows
        .filter((row) => visibleTask(row.task.createdBy))
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

      const leftoverPersonIds = [
        ...new Set(leftoverMeetings.map((item) => item.person.id)),
      ];
      const latestClosedByPerson = new Map<string, string>();
      if (leftoverPersonIds.length > 0) {
        const closedMeetingRows = await app.db
          .select({
            personId: tasks.personId,
            dueAt: tasks.dueAt,
            outcome: tasks.outcome,
            status: tasks.status,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.kind, "meeting"),
              ne(tasks.status, "open"),
              inArray(tasks.personId, leftoverPersonIds),
            ),
          );
        const closedByPerson = new Map<
          string,
          Array<{
            dueAt: string;
            outcome: (typeof closedMeetingRows)[number]["outcome"];
            status: string;
          }>
        >();
        for (const row of closedMeetingRows) {
          const list = closedByPerson.get(row.personId) ?? [];
          list.push({
            dueAt: row.dueAt.toISOString(),
            outcome: row.outcome,
            status: row.status,
          });
          closedByPerson.set(row.personId, list);
        }
        for (const [personId, rows] of closedByPerson) {
          const latest = latestHandSetMeetingDueAt(rows);
          if (latest) {
            latestClosedByPerson.set(personId, latest);
          }
        }
      }

      leftoverMeetings = leftoverMeetings.filter(
        (item) =>
          !isOpenMeetingSupersededByLaterOutcome({
            dueAt: item.task.dueAt,
            latestClosedDueAt:
              latestClosedByPerson.get(item.person.id) ?? null,
          }),
      );

      const todayMeetings: HomeScheduleItem[] = todayMeetingRows
        .filter((row) => visibleTask(row.task.createdBy))
        .map(toScheduleItem);

      const skipCallPersonIds = new Set<string>();
      for (const meeting of upcomingMeetingRows) {
        if (!visibleTask(meeting.createdBy)) {
          continue;
        }
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

      const allOpenTasks = openTaskRows
        .filter((row) => visibleTask(row.task.createdBy))
        .filter((row) => {
          if (row.task.kind !== "meeting") {
            return true;
          }
          return !isOpenMeetingSupersededByLaterOutcome({
            dueAt: row.task.dueAt.toISOString(),
            latestClosedDueAt: latestClosedByPerson.get(row.person.id) ?? null,
          });
        })
        .map((row) => ({
          id: row.task.id,
          personId: row.person.id,
          kind: row.task.kind,
          dueAt: row.task.dueAt.toISOString(),
          calendarEventId: row.task.calendarEventId,
        }));

      const todayEmailTasks: HomeScheduleItem[] = [];
      const openTasks: HomeOpenTaskInput[] = [];
      for (const row of openTaskRows) {
        if (!visibleTask(row.task.createdBy)) {
          continue;
        }
        if (row.task.kind === "email" && isWithinUtcBounds(row.task.dueAt, today)) {
          todayEmailTasks.push(toScheduleItem(row));
          continue;
        }
        if (row.task.kind === "call" || row.task.kind === "meeting") {
          skipCallPersonIds.add(row.person.id);
        }
        if (row.task.kind === "meeting" || closeTaskIds.has(row.task.id)) {
          continue;
        }
        if (row.task.dueAt.getTime() >= today.end.getTime()) {
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

      const unmatchedEmails = unmatchedRows
        .filter((row) => emailThreadRowVisible(row, user, owners))
        .map((row) => {
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
      const campaignReview = campaignReviewRows.map((row) =>
        digestPerson(serializePerson(row.person)),
      );
      const campaignReviewIds = new Set(
        campaignReview.map((person) => person.id),
      );
      const needsReview: HomePersonInput[] = needsReviewRows
        .filter((row) => !campaignReviewIds.has(row.id))
        .map((row) => ({
          person: digestPerson(serializePerson(row)),
          firstName: row.firstName,
          lastName: row.lastName,
          needsReview: row.needsReview,
        }));

      const todos = buildHomeTodos({
        leftoverMeetings,
        todayMeetings,
        openTasks,
        allOpenTasks,
        unmatchedEmails,
        callsDue,
        decisions,
        incubatorWaiting,
        needsTrack,
        needsReview,
        campaignReview,
        now,
      });

      const emails = [
        ...todayEmailTasks.map((item) => ({
          kind: "task" as const,
          task: item.task,
          person: item.person,
        })),
        ...todayEmailRows
          .filter((row) => emailThreadRowVisible(row.thread, user, owners))
          .map((row) => ({
            kind: "thread" as const,
            thread: emailThreadSchema.parse(serializeEmailThread(row.thread)),
            person: row.person
              ? digestPerson(serializePerson(row.person))
              : null,
          })),
      ];

      return homeSnapshotResponseSchema.parse({
        date: todayYmd,
        todos,
        schedule: todayMeetings,
        emails,
        counts: homeCounts({
          todos,
          leftoverCount: leftoverMeetings.length,
          scheduleCount: todayMeetings.length,
          emailCount: emails.length,
        }),
        deliverability,
      });
    },
  );
};
