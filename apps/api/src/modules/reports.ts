import {
  canViewPerson,
  computeReport,
  parseReportRange,
  reportQuerySchema,
  reportResponseSchema,
  type ReportMeetingInput,
  type ReportPersonInput,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { eq, isNull } from "drizzle-orm";
import {
  allocationCards,
  meetings,
  people,
  reportInputs,
} from "@realm-labs/db";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/reports",
    {
      schema: {
        querystring: reportQuerySchema,
        response: { 200: reportResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      if (!canViewPerson()) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }

      const parsed = parseReportRange(req.query);
      if (!parsed.ok) {
        throw httpError(400, "INVALID_RANGE", parsed.message);
      }

      const [periodRows, personRows, meetingRows] = await Promise.all([
        app.db
          .select({
            periodStart: reportInputs.periodStart,
            periodEnd: reportInputs.periodEnd,
            linkedinImpressions: reportInputs.linkedinImpressions,
            jobPostApplies: reportInputs.jobPostApplies,
          })
          .from(reportInputs),
        app.db
          .select({
            id: people.id,
            appliedAt: people.appliedAt,
            budgetQualified: people.budgetQualified,
            allocationStage: allocationCards.stage,
            allocationDecision: allocationCards.decision,
            noCallAppLink: allocationCards.noCallAppLink,
          })
          .from(people)
          .leftJoin(allocationCards, eq(allocationCards.personId, people.id))
          .where(isNull(people.deletedAt)),
        app.db
          .select({
            id: meetings.id,
            personId: meetings.personId,
            scheduledAt: meetings.scheduledAt,
            outcome: meetings.outcome,
          })
          .from(meetings)
          .innerJoin(people, eq(people.id, meetings.personId))
          .where(isNull(people.deletedAt)),
      ]);

      const reportPeople: ReportPersonInput[] = personRows.map((row) => ({
        id: row.id,
        appliedAt: row.appliedAt,
        budgetQualified: row.budgetQualified,
        allocationStage: row.allocationStage ?? null,
        allocationDecision: row.allocationDecision ?? null,
        noCallAppLink: row.noCallAppLink ?? false,
      }));

      const reportMeetings: ReportMeetingInput[] = meetingRows.map((row) => ({
        id: row.id,
        personId: row.personId,
        scheduledAt: row.scheduledAt.toISOString(),
        outcome: row.outcome,
      }));

      return reportResponseSchema.parse(
        computeReport({
          range: parsed.range,
          periods: periodRows,
          people: reportPeople,
          meetings: reportMeetings,
        }),
      );
    },
  );
};
