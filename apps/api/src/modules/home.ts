import {
  ALLOCATION_STAGE_LABELS,
  buildHomeTodos,
  canViewCard,
  canViewEmailThread,
  canViewMeeting,
  emailThreadSchema,
  homeCounts,
  homeSnapshotResponseSchema,
  isIncubatorWaitingStage,
  isNurtureDue,
  meetingDigestPersonSchema,
  meetingSchema,
  todayBoundsUtc,
  yesterdayBoundsUtc,
  zonedIsoDate,
  type HomeCallInput,
  type HomeDecisionInput,
  type HomeIncubatorInput,
  type HomeNurtureInput,
  type MeetingDigestItem,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  allocationCards,
  emailThreads,
  incubatorCards,
  meetings,
  people,
} from "@realm-labs/db";
import { emailThreadsVisibleSql } from "../lib/email-visibility.js";
import {
  serializeEmailThread,
  serializeMeeting,
  serializePerson,
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
      const yesterday = yesterdayBoundsUtc(now);
      const visibility = emailThreadsVisibleSql(user.email) ?? sql`true`;

      const [
        leftoverRows,
        todayMeetingRows,
        unmatchedRows,
        todayEmailRows,
        allocationRows,
        nurtureRows,
        incubatorRows,
        upcomingMeetingRows,
      ] = await Promise.all([
        app.db
          .select({ meeting: meetings, person: people })
          .from(meetings)
          .innerJoin(people, eq(meetings.personId, people.id))
          .where(
            and(
              eq(meetings.outcome, "scheduled"),
              gte(meetings.scheduledAt, yesterday.start),
              lt(meetings.scheduledAt, yesterday.end),
              isNull(people.deletedAt),
              eq(people.doNotContact, false),
            ),
          )
          .orderBy(asc(meetings.scheduledAt)),
        app.db
          .select({ meeting: meetings, person: people })
          .from(meetings)
          .innerJoin(people, eq(meetings.personId, people.id))
          .where(
            and(
              eq(meetings.outcome, "scheduled"),
              gte(meetings.scheduledAt, today.start),
              lt(meetings.scheduledAt, today.end),
              isNull(people.deletedAt),
              eq(people.doNotContact, false),
            ),
          )
          .orderBy(asc(meetings.scheduledAt)),
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
                and(
                  isNull(people.deletedAt),
                  eq(people.doNotContact, false),
                ),
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
              isNull(people.deletedAt),
              eq(people.doNotContact, false),
              inArray(allocationCards.stage, [
                "contacted",
                "in_conversation",
                "decision",
              ]),
            ),
          ),
        app.db
          .select({ card: allocationCards, person: people })
          .from(allocationCards)
          .innerJoin(people, eq(allocationCards.personId, people.id))
          .where(
            and(
              isNull(people.deletedAt),
              eq(people.doNotContact, false),
              eq(allocationCards.stage, "nurture"),
            ),
          )
          .orderBy(asc(allocationCards.nurtureFollowUpAt)),
        app.db
          .select({ card: incubatorCards, person: people })
          .from(incubatorCards)
          .innerJoin(people, eq(incubatorCards.personId, people.id))
          .where(
            and(
              isNull(people.deletedAt),
              eq(people.doNotContact, false),
              inArray(incubatorCards.stage, [
                "application_received",
                "offer_made",
              ]),
            ),
          ),
        app.db
          .select()
          .from(meetings)
          .where(
            and(
              gte(meetings.scheduledAt, now),
              inArray(meetings.outcome, ["scheduled", "rescheduled"]),
            ),
          )
          .orderBy(asc(meetings.scheduledAt)),
      ]);

      const leftoverMeetings: MeetingDigestItem[] = leftoverRows.map((row) => ({
        meeting: meetingSchema.parse(serializeMeeting(row.meeting)),
        person: digestPerson(serializePerson(row.person)),
      }));

      const todayMeetings: MeetingDigestItem[] = todayMeetingRows.map((row) => ({
        meeting: meetingSchema.parse(serializeMeeting(row.meeting)),
        person: digestPerson(serializePerson(row.person)),
      }));

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

      const callsDue: HomeCallInput[] = [];
      const decisions: HomeDecisionInput[] = [];
      for (const row of allocationRows) {
        const person = digestPerson(serializePerson(row.person));
        if (row.card.stage === "decision") {
          decisions.push({ person });
          continue;
        }
        if (row.card.stage !== "contacted" && row.card.stage !== "in_conversation") {
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

      const nurtureDue: HomeNurtureInput[] = nurtureRows
        .filter((row) => isNurtureDue(row.card.nurtureFollowUpAt, todayYmd))
        .map((row) => ({
          person: digestPerson(serializePerson(row.person)),
          followUpAt: row.card.nurtureFollowUpAt,
        }));

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

      const todos = buildHomeTodos({
        leftoverMeetings,
        todayMeetings,
        unmatchedEmails,
        callsDue,
        decisions,
        nurtureDue,
        incubatorWaiting,
        now,
      });

      const emails = todayEmailRows
        .filter((row) =>
          canViewEmailThread({
            mailbox: row.thread.mailbox,
            sharedVisible: row.thread.sharedVisible,
            viewerEmail: user.email,
          }),
        )
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
