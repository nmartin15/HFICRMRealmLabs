/*
 * Website lead intake — curl examples
 *
 * Valid create (201):
 *   curl -sS -X POST "$API/api/leads/website" \
 *     -H "Authorization: Bearer $WEBSITE_INTAKE_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -H "Origin: $WEBSITE_ORIGIN" \
 *     -d '{"name":"Ada Lovelace","email":"ada@example.com","programInterest":"not_sure","message":"Interested"}'
 *
 * Unauthorized (401):
 *   curl -sS -X POST "$API/api/leads/website" \
 *     -H "Authorization: Bearer wrong-secret" \
 *     -H "Content-Type: application/json" \
 *     -d '{"name":"Ada Lovelace","email":"ada@example.com","programInterest":"not_sure"}'
 *
 * Duplicate email (200 updated) — POST the same email again with a new message:
 *   curl -sS -X POST "$API/api/leads/website" \
 *     -H "Authorization: Bearer $WEBSITE_INTAKE_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"name":"Ada Lovelace","email":"ada@example.com","programInterest":"lp_raising_program","message":"Following up"}'
 */

import {
  WEBSITE_INTAKE_ACTOR,
  isWebsiteLeadHoneypot,
  planWebsiteLead,
  todayIsoInDisplayZone,
  websiteLeadBodySchema,
  websiteLeadResponseSchema,
  type WebsiteLeadBody,
  type WebsiteLeadResponse,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { eq } from "drizzle-orm";
import {
  allocationCards,
  people,
  type Database,
} from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import { secretsEqual } from "../lib/secrets.js";
import { httpError } from "../plugins/error.js";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const rateLimitHits = new Map<string, number[]>();

function clientIp(req: { ip: string }): string {
  return req.ip || "unknown";
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const prior = rateLimitHits.get(ip) ?? [];
  const recent = prior.filter((ts) => ts > windowStart);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateLimitHits.set(ip, recent);
  return true;
}

function bearerToken(
  authorization: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!raw) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1];
}

function setWebsiteCorsHeaders(
  reply: {
    header: (name: string, value: string) => unknown;
  },
  origin: string,
): void {
  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  reply.header(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type",
  );
  reply.header("Access-Control-Max-Age", "86400");
  reply.header("Vary", "Origin");
}

async function personByEmail(db: Database, email: string) {
  const rows = await db
    .select()
    .from(people)
    .where(eq(people.email, email))
    .limit(1);
  const person = rows[0];
  if (!person) {
    return null;
  }
  const cardRows = await db
    .select({ id: allocationCards.id })
    .from(allocationCards)
    .where(eq(allocationCards.personId, person.id))
    .limit(1);
  return {
    person,
    hasAllocationCard: Boolean(cardRows[0]),
  };
}

export const leadRoutes: FastifyPluginAsyncZod = async (app) => {
  const websiteOrigin = app.env.WEBSITE_ORIGIN;

  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0] ?? req.url;
    if (!path.startsWith("/leads/website") && !path.startsWith("/api/leads/website")) {
      return;
    }
    if (!websiteOrigin) {
      return;
    }
    const origin = req.headers.origin;
    if (origin === websiteOrigin) {
      setWebsiteCorsHeaders(reply, websiteOrigin);
    }
  });

  app.options("/leads/website", async (req, reply) => {
    if (websiteOrigin && req.headers.origin === websiteOrigin) {
      setWebsiteCorsHeaders(reply, websiteOrigin);
    }
    return reply.code(204).send();
  });

  app.post(
    "/leads/website",
    {
      schema: {
        body: websiteLeadBodySchema,
        response: {
          200: websiteLeadResponseSchema,
          201: websiteLeadResponseSchema,
        },
      },
    },
    async (req, reply): Promise<WebsiteLeadResponse> => {
      if (!checkRateLimit(clientIp(req))) {
        throw httpError(429, "RATE_LIMITED", "Too many requests");
      }

      const expected = app.env.WEBSITE_INTAKE_SECRET;
      const provided = bearerToken(req.headers.authorization);
      if (!provided || !secretsEqual(provided, expected)) {
        throw httpError(401, "UNAUTHORIZED", "Unauthorized");
      }

      const body: WebsiteLeadBody = req.body;
      if (isWebsiteLeadHoneypot(body)) {
        return reply.code(200).send({ status: "updated" });
      }

      const matched = await personByEmail(app.db, body.email);
      const plan = planWebsiteLead({
        name: body.name,
        message: body.message,
        linkedinUrl: body.linkedinUrl,
        yearsExperience: body.yearsExperience,
        existing: matched
          ? {
              id: matched.person.id,
              doNotContact: matched.person.doNotContact,
              deleted: Boolean(matched.person.deletedAt),
              hasAllocationCard: matched.hasAllocationCard,
            }
          : null,
        existingNotes: matched?.person.notes ?? null,
      });

      if (!plan.ok) {
        throw httpError(plan.status, plan.code, plan.message);
      }

      const when = new Date();
      const who = {
        id: WEBSITE_INTAKE_ACTOR.id,
        email: WEBSITE_INTAKE_ACTOR.email,
      };

      if (plan.action === "create") {
        const result = await app.db.transaction(async (tx) => {
          const typedTx = tx as unknown as Database;
          const [created] = await tx
            .insert(people)
            .values({
              firstName: plan.firstName,
              lastName: plan.lastName,
              email: body.email,
              source: "website",
              appliedAt: todayIsoInDisplayZone(when),
              notes: plan.notes,
              programTrack: "allocation",
              programInterest: body.programInterest,
            })
            .returning();
          if (!created) {
            throw httpError(500, "INTERNAL", "Failed to create person");
          }

          await tx.insert(allocationCards).values({
            personId: created.id,
            stage: "applied",
          });

          await writeActivity(typedTx, {
            personId: created.id,
            userId: null,
            type: "field_change",
            payload: {
              who,
              what: "website.lead.create",
              when: when.toISOString(),
              before: null,
              after: {
                email: body.email,
                programInterest: body.programInterest,
                source: "website",
              },
            },
          });

          await writeActivity(typedTx, {
            personId: created.id,
            userId: null,
            type: "stage_change",
            payload: {
              who,
              what: "allocation.stage_change",
              when: when.toISOString(),
              before: null,
              after: { stage: "applied", source: "website" },
            },
          });

          return created.id;
        });

        return reply.code(201).send({ status: "created", id: result });
      }

      await app.db.transaction(async (tx) => {
        const typedTx = tx as unknown as Database;
        const before = {
          notes: matched?.person.notes ?? null,
          programInterest: matched?.person.programInterest ?? null,
          programTrack: matched?.person.programTrack ?? null,
        };

        await tx
          .update(people)
          .set({
            notes: plan.notes,
            programInterest: body.programInterest,
            ...(plan.setProgramTrackAllocation
              ? { programTrack: "allocation" as const }
              : {}),
            ...(matched?.person.deletedAt && plan.setProgramTrackAllocation
              ? { deletedAt: null }
              : {}),
          })
          .where(eq(people.id, plan.personId));

        if (plan.ensureAllocationCard) {
          await tx.insert(allocationCards).values({
            personId: plan.personId,
            stage: "applied",
          });
          await writeActivity(typedTx, {
            personId: plan.personId,
            userId: null,
            type: "stage_change",
            payload: {
              who,
              what: "allocation.stage_change",
              when: when.toISOString(),
              before: null,
              after: { stage: "applied", source: "website" },
            },
          });
        }

        await writeActivity(typedTx, {
          personId: plan.personId,
          userId: null,
          type: "field_change",
          payload: {
            who,
            what: "website.lead.update",
            when: when.toISOString(),
            before,
            after: {
              notes: plan.notes,
              programInterest: body.programInterest,
              ...(plan.setProgramTrackAllocation
                ? { programTrack: "allocation" }
                : {}),
            },
          },
        });
      });

      return reply.code(200).send({ status: "updated" });
    },
  );
};
