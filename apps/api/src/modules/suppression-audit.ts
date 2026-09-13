import {
  canInspectScoring,
  suppressionAuditListResponseSchema,
  suppressionReasonSchema,
  suppressionSourceSchema,
  type SuppressionAuditListResponse,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { desc } from "drizzle-orm";
import {
  emailSuppressionEvents,
  emailSuppressions,
  people,
} from "@realm-labs/db";
import { emailSuppressionHash } from "../lib/suppression.js";
import { toIso } from "../lib/serialize.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

function payloadEmail(payload: Record<string, unknown>): string | null {
  const value = payload.email;
  return typeof value === "string" && value.includes("@") ? value : null;
}

export const suppressionAuditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/suppressions",
    {
      schema: { response: { 200: suppressionAuditListResponseSchema } },
    },
    async (req): Promise<SuppressionAuditListResponse> => {
      const user = requireUser(req);
      if (!canInspectScoring(user.role)) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }
      const rows = await app.db
        .select()
        .from(emailSuppressions)
        .orderBy(desc(emailSuppressions.occurredAt));
      const peopleRows = await app.db
        .select({ id: people.id, email: people.email })
        .from(people);
      const emailByHash = new Map<string, string>();
      for (const person of peopleRows) {
        emailByHash.set(
          emailSuppressionHash(person.email, app.env.EMAIL_HASH_KEY),
          person.email,
        );
      }
      const eventRows = await app.db
        .select({
          suppressionId: emailSuppressionEvents.suppressionId,
          source: emailSuppressionEvents.source,
          payload: emailSuppressionEvents.payload,
          occurredAt: emailSuppressionEvents.occurredAt,
        })
        .from(emailSuppressionEvents)
        .orderBy(desc(emailSuppressionEvents.occurredAt));
      const latestBySuppression = new Map<
        string,
        { source: string; payload: Record<string, unknown> }
      >();
      for (const event of eventRows) {
        if (!latestBySuppression.has(event.suppressionId)) {
          latestBySuppression.set(event.suppressionId, {
            source: event.source,
            payload: event.payload,
          });
        }
      }
      const data = [];
      for (const row of rows) {
        const reason = suppressionReasonSchema.safeParse(row.reason);
        const source = suppressionSourceSchema.safeParse(row.source);
        if (!reason.success || !source.success) {
          continue;
        }
        const latest = latestBySuppression.get(row.id);
        const email =
          (latest ? payloadEmail(latest.payload) : null) ??
          emailByHash.get(row.emailHash) ??
          null;
        data.push({
          id: row.id,
          email,
          emailHash: row.emailHash,
          reason: reason.data,
          source: source.data,
          occurredAt: toIso(row.occurredAt),
          purgedAt: row.purgedAt ? toIso(row.purgedAt) : null,
          trigger: latest?.source ?? row.source,
        });
      }
      return suppressionAuditListResponseSchema.parse({ data });
    },
  );
};
