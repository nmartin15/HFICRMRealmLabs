import {
  campaignTagListQuerySchema,
  campaignTagListResponseSchema,
  campaignTagPayloadSchema,
  campaignTagReleaseParamsSchema,
  outboundSendBodySchema,
  outboundSendResponseSchema,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { people, personCampaignTags } from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import { sendEmail } from "../lib/send.js";
import { hmacSha256Hex, secretsEqual } from "../lib/secrets.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

function bearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }
  return token;
}

function requireCampaignSyncSecret(
  authorization: string | undefined,
  expected: string,
): void {
  const provided = bearerToken(authorization);
  if (!expected || !provided || !secretsEqual(provided, expected)) {
    throw httpError(401, "UNAUTHORIZED", "Unauthorized");
  }
}

export const campaignTagRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/campaign-tags",
    {
      schema: {
        querystring: campaignTagListQuerySchema,
        response: { 200: campaignTagListResponseSchema },
      },
    },
    async (req) => {
      requireCampaignSyncSecret(
        req.headers.authorization,
        app.env.CAMPAIGN_SYNC_SECRET,
      );
      const sinceRevision = req.query.sinceRevision ?? 0;
      const rows = await app.db
        .select({
          tag: personCampaignTags,
          person: people,
        })
        .from(personCampaignTags)
        .innerJoin(people, eq(personCampaignTags.personId, people.id))
        .where(
          and(
            isNotNull(personCampaignTags.tag),
            gt(personCampaignTags.revision, sinceRevision),
            isNull(people.deletedAt),
            eq(people.doNotContact, false),
          ),
        );
      const asOf = new Date().toISOString();
      const data = rows.map((row) =>
        campaignTagPayloadSchema.parse({
          schemaVersion: "v1",
          personId: row.person.id,
          email: row.person.email,
          tag: row.tag.tag,
          previousTag: row.tag.previousTag,
          sequenceId: row.tag.sequenceId,
          sequenceAction: row.tag.sequenceAction,
          lane: row.tag.lane,
          program: row.tag.program,
          stage: row.tag.stage,
          intensity: row.tag.intensity,
          bucket: row.tag.bucket,
          revision: row.tag.revision,
          computedAt: row.tag.computedAt.toISOString(),
          asOf: row.tag.asOf.toISOString(),
        }),
      );
      const maxRevision = data.reduce(
        (max, item) => (item.revision > max ? item.revision : max),
        sinceRevision,
      );
      return campaignTagListResponseSchema.parse({
        schemaVersion: "v1",
        asOf,
        maxRevision,
        data,
      });
    },
  );

  app.post(
    "/sends",
    {
      schema: {
        body: outboundSendBodySchema,
        response: { 200: outboundSendResponseSchema },
      },
    },
    async (req) => {
      requireCampaignSyncSecret(
        req.headers.authorization,
        app.env.CAMPAIGN_SYNC_SECRET,
      );
      let doNotContact = false;
      if (req.body.personId) {
        const personRows = await app.db
          .select({ doNotContact: people.doNotContact, deletedAt: people.deletedAt })
          .from(people)
          .where(eq(people.id, req.body.personId))
          .limit(1);
        const person = personRows[0];
        if (!person || person.deletedAt) {
          throw httpError(404, "NOT_FOUND", "Person not found");
        }
        doNotContact = person.doNotContact;
      }
      return sendEmail(app.db, {
        to: req.body.to,
        purpose: req.body.purpose,
        subject: req.body.subject,
        bodyText: req.body.bodyText,
        emailHashKey: app.env.EMAIL_HASH_KEY,
        personId: req.body.personId ?? null,
        tag: req.body.tag ?? null,
        doNotContact,
      });
    },
  );

  app.post(
    "/campaign-tags/:personId/release",
    {
      schema: {
        params: campaignTagReleaseParamsSchema,
        response: { 200: campaignTagPayloadSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      if (actor.role !== "admin") {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }
      const rows = await app.db
        .select({
          tag: personCampaignTags,
          person: people,
        })
        .from(personCampaignTags)
        .innerJoin(people, eq(personCampaignTags.personId, people.id))
        .where(eq(personCampaignTags.personId, req.params.personId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw httpError(404, "NOT_FOUND", "Campaign tag not found");
      }
      if (row.tag.sequenceAction !== "pending_review") {
        throw httpError(
          409,
          "NOT_PENDING_REVIEW",
          "This contact is not waiting on send review",
        );
      }
      const now = new Date();
      const revision = row.tag.revision + 1;
      const [updated] = await app.db
        .update(personCampaignTags)
        .set({
          sequenceAction: "start",
          lastSequenceStartAt: now,
          lastStartProgramStageKey: row.tag.programStageKey,
          previousTag: row.tag.tag,
          revision,
          asOf: now,
          computedAt: now,
        })
        .where(eq(personCampaignTags.id, row.tag.id))
        .returning();
      if (!updated) {
        throw httpError(500, "INTERNAL", "Failed to release campaign tag");
      }
      await writeActivity(app.db, {
        personId: row.person.id,
        userId: actor.id,
        type: "field_change",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "campaign.tag_release",
          when: now.toISOString(),
          before: { action: "pending_review", revision: row.tag.revision },
          after: { action: "start", revision },
        },
      });
      const payload = campaignTagPayloadSchema.parse({
        schemaVersion: "v1",
        personId: row.person.id,
        email: row.person.email,
        tag: updated.tag,
        previousTag: updated.previousTag,
        sequenceId: updated.sequenceId,
        sequenceAction: updated.sequenceAction,
        lane: updated.lane,
        program: updated.program,
        stage: updated.stage,
        intensity: updated.intensity,
        bucket: updated.bucket,
        revision: updated.revision,
        computedAt: updated.computedAt.toISOString(),
        asOf: updated.asOf.toISOString(),
      });
      const webhookUrl = app.env.CAMPAIGN_TAG_WEBHOOK_URL.trim();
      if (webhookUrl) {
        const body = JSON.stringify(payload);
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        const secret = app.env.CAMPAIGN_TAG_WEBHOOK_SECRET.trim();
        if (secret) {
          headers["x-realm-signature"] = hmacSha256Hex(secret, body);
        }
        try {
          await fetch(webhookUrl, { method: "POST", headers, body });
        } catch {
          // Review release is persisted even if the sequence tool is down.
        }
      }
      return payload;
    },
  );
};
