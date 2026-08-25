import {
  okResponseSchema,
  reportInputCreateBodySchema,
  reportInputIdParamsSchema,
  reportInputListResponseSchema,
  reportInputSchema,
  reportInputUpdateBodySchema,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { desc, eq } from "drizzle-orm";
import { reportInputs } from "@realm-labs/db";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

function serializeReportInput(row: typeof reportInputs.$inferSelect) {
  return {
    id: row.id,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    linkedinImpressions: row.linkedinImpressions,
    jobPostApplies: row.jobPostApplies,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const reportInputRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/report-inputs",
    {
      schema: {
        response: { 200: reportInputListResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      const rows = await app.db
        .select()
        .from(reportInputs)
        .orderBy(desc(reportInputs.periodStart));
      return {
        data: rows.map((row) =>
          reportInputSchema.parse(serializeReportInput(row)),
        ),
      };
    },
  );

  app.post(
    "/report-inputs",
    {
      schema: {
        body: reportInputCreateBodySchema,
        response: { 200: reportInputSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const [created] = await app.db
        .insert(reportInputs)
        .values({
          periodStart: req.body.periodStart,
          periodEnd: req.body.periodEnd,
          linkedinImpressions: req.body.linkedinImpressions,
          jobPostApplies: req.body.jobPostApplies,
          createdBy: user.id,
        })
        .returning();
      if (!created) {
        throw httpError(500, "INTERNAL", "Failed to create report input");
      }

      // TODO: activities.person_id is required, so report input mutations cannot write an activity row.

      return reportInputSchema.parse(serializeReportInput(created));
    },
  );

  app.patch(
    "/report-inputs/:id",
    {
      schema: {
        params: reportInputIdParamsSchema,
        body: reportInputUpdateBodySchema,
        response: { 200: reportInputSchema },
      },
    },
    async (req) => {
      requireUser(req);
      const { id } = req.params;
      const existing = await app.db
        .select()
        .from(reportInputs)
        .where(eq(reportInputs.id, id))
        .limit(1);
      if (!existing[0]) {
        throw httpError(404, "NOT_FOUND", "Report input not found");
      }

      const [updated] = await app.db
        .update(reportInputs)
        .set({
          ...(req.body.periodStart !== undefined
            ? { periodStart: req.body.periodStart }
            : {}),
          ...(req.body.periodEnd !== undefined
            ? { periodEnd: req.body.periodEnd }
            : {}),
          ...(req.body.linkedinImpressions !== undefined
            ? { linkedinImpressions: req.body.linkedinImpressions }
            : {}),
          ...(req.body.jobPostApplies !== undefined
            ? { jobPostApplies: req.body.jobPostApplies }
            : {}),
        })
        .where(eq(reportInputs.id, id))
        .returning();
      if (!updated) {
        throw httpError(404, "NOT_FOUND", "Report input not found");
      }

      // TODO: activities.person_id is required, so report input mutations cannot write an activity row.

      return reportInputSchema.parse(serializeReportInput(updated));
    },
  );

  app.delete(
    "/report-inputs/:id",
    {
      schema: {
        params: reportInputIdParamsSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      const { id } = req.params;
      const deleted = await app.db
        .delete(reportInputs)
        .where(eq(reportInputs.id, id))
        .returning({ id: reportInputs.id });
      if (!deleted[0]) {
        throw httpError(404, "NOT_FOUND", "Report input not found");
      }

      // TODO: activities.person_id is required, so report input mutations cannot write an activity row.

      return { ok: true as const };
    },
  );
};
