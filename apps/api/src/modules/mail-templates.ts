import {
  canInspectScoring,
  MAIL_TEMPLATE_CATALOG,
  mailTemplateKey,
  mailTemplateListResponseSchema,
  mailTemplateSchema,
  mailTemplateUpsertBodySchema,
  type MailTemplateListResponse,
} from "@realm-labs/contracts";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, eq } from "drizzle-orm";
import { mailTemplates } from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import { toIso } from "../lib/serialize.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

function requireAdmin(req: FastifyRequest) {
  const user = requireUser(req);
  if (!canInspectScoring(user.role)) {
    throw httpError(403, "FORBIDDEN", "Forbidden");
  }
  return user;
}

function serializeTemplate(row: typeof mailTemplates.$inferSelect) {
  return mailTemplateSchema.parse({
    id: row.id,
    lane: row.lane,
    program: row.program,
    stage: row.stage,
    purpose: row.purpose,
    subject: row.subject,
    bodyText: row.bodyText,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

export const mailTemplateRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/mail-templates",
    {
      schema: { response: { 200: mailTemplateListResponseSchema } },
    },
    async (req): Promise<MailTemplateListResponse> => {
      requireAdmin(req);
      const rows = await app.db.select().from(mailTemplates);
      return mailTemplateListResponseSchema.parse({
        data: rows.map(serializeTemplate),
        catalog: MAIL_TEMPLATE_CATALOG,
      });
    },
  );

  app.put(
    "/mail-templates",
    {
      schema: {
        body: mailTemplateUpsertBodySchema,
        response: { 200: mailTemplateSchema },
      },
    },
    async (req) => {
      const actor = requireAdmin(req);
      const allowed = MAIL_TEMPLATE_CATALOG.find(
        (entry) =>
          mailTemplateKey(entry) === mailTemplateKey(req.body) &&
          entry.purpose === req.body.purpose,
      );
      if (!allowed) {
        throw httpError(400, "UNKNOWN_TEMPLATE", "Unknown mail template");
      }
      const existing = await app.db
        .select()
        .from(mailTemplates)
        .where(
          and(
            eq(mailTemplates.lane, req.body.lane),
            eq(mailTemplates.program, req.body.program),
            eq(mailTemplates.stage, req.body.stage),
          ),
        )
        .limit(1);
      const now = new Date();
      let row: typeof mailTemplates.$inferSelect;
      if (existing[0]) {
        const [updated] = await app.db
          .update(mailTemplates)
          .set({
            purpose: req.body.purpose,
            subject: req.body.subject,
            bodyText: req.body.bodyText,
          })
          .where(eq(mailTemplates.id, existing[0].id))
          .returning();
        if (!updated) {
          throw httpError(500, "INTERNAL", "Failed to save mail template");
        }
        row = updated;
      } else {
        const [inserted] = await app.db
          .insert(mailTemplates)
          .values({
            lane: req.body.lane,
            program: req.body.program,
            stage: req.body.stage,
            purpose: req.body.purpose,
            subject: req.body.subject,
            bodyText: req.body.bodyText,
          })
          .returning();
        if (!inserted) {
          throw httpError(500, "INTERNAL", "Failed to save mail template");
        }
        row = inserted;
      }
      await writeActivity(app.db, {
        personId: null,
        userId: actor.id,
        type: "field_change",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "mail.template_save",
          when: now.toISOString(),
          before: existing[0]
            ? { subject: existing[0].subject, bodyText: existing[0].bodyText }
            : null,
          after: {
            lane: row.lane,
            program: row.program,
            stage: row.stage,
            subject: row.subject,
          },
        },
      });
      return serializeTemplate(row);
    },
  );
};
