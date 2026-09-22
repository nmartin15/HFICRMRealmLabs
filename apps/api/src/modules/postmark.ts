import {
  okResponseSchema,
  planCampaignUnsubscribe,
  unsubscribeConfirmCopy,
  unsubscribeHttpAction,
  unsubscribeParamsSchema,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { eq } from "drizzle-orm";
import {
  findPersonByEmail,
  outboundSends,
  persistStayInTouchOptOut,
  type Database,
} from "@realm-labs/db";
import { basicAuthMatches } from "../lib/basic-auth.js";
import { applyPostmarkWebhook } from "../lib/postmark-events.js";
import { writeSuppression } from "../lib/suppression.js";
import { httpError } from "../plugins/error.js";

export function unsubscribeConfirmationHtml(purpose: "sales" | "newsletter" | "value_add" | null): string {
  const copy = unsubscribeConfirmCopy(purpose);
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${copy.title}</title>
<body>
  <p>${copy.prompt}</p>
  <form method="post">
    <button type="submit" autofocus>Unsubscribe</button>
  </form>
</body>
</html>
`;
}

async function loadSendForUnsubscribeToken(db: Database, token: string) {
  const rows = await db
    .select({
      toEmail: outboundSends.toEmail,
      personId: outboundSends.personId,
      purpose: outboundSends.purpose,
    })
    .from(outboundSends)
    .where(eq(outboundSends.unsubscribeToken, token))
    .limit(1);
  return rows[0] ?? null;
}

export async function unsubscribeByToken(
  db: Database,
  emailHashKey: string,
  token: string,
): Promise<void> {
  const row = await loadSendForUnsubscribeToken(db, token);
  if (!row) {
    throw httpError(404, "NOT_FOUND", "Unsubscribe link is not valid");
  }
  const person = await findPersonByEmail(db, row.toEmail);
  const plan = planCampaignUnsubscribe(row.purpose);
  if (plan.kind === "stay_in_touch_opt_out") {
    const personId = person?.id ?? row.personId;
    if (personId) {
      await persistStayInTouchOptOut(db, { personId, when: new Date() });
    }
    return;
  }
  await writeSuppression(db, {
    email: row.toEmail,
    keyHex: emailHashKey,
    reason: "unsubscribed",
    source: "one_click",
    occurredAt: new Date(),
    createdBy: null,
    actorEmail: "one-click",
    personId: person?.id ?? row.personId,
  });
}

export const postmarkRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/webhooks/postmark",
    {
      schema: {
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      if (
        !basicAuthMatches(
          req.headers.authorization,
          app.env.POSTMARK_WEBHOOK_USER,
          app.env.POSTMARK_WEBHOOK_PASSWORD,
        )
      ) {
        throw httpError(401, "UNAUTHORIZED", "Unauthorized");
      }
      await applyPostmarkWebhook(app.db, {
        body: req.body,
        emailHashKey: app.env.EMAIL_HASH_KEY,
        traceHeader: req.headers["x-pm-webhook-trace-id"],
      });
      return { ok: true as const };
    },
  );

  app.post(
    "/unsubscribe/:token",
    {
      schema: {
        params: unsubscribeParamsSchema,
      },
    },
    async (req, reply) => {
      if (unsubscribeHttpAction(req.method) !== "write") {
        throw httpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      await unsubscribeByToken(
        app.db,
        app.env.EMAIL_HASH_KEY,
        req.params.token,
      );
      return reply.code(200).send();
    },
  );

  app.get(
    "/unsubscribe/:token",
    {
      schema: {
        params: unsubscribeParamsSchema,
      },
    },
    async (req, reply) => {
      if (unsubscribeHttpAction(req.method) !== "confirm") {
        throw httpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const row = await loadSendForUnsubscribeToken(
        app.db,
        req.params.token,
      );
      if (!row) {
        throw httpError(404, "NOT_FOUND", "Unsubscribe link is not valid");
      }
      return reply
        .type("text/html; charset=utf-8")
        .send(unsubscribeConfirmationHtml(row.purpose ?? null));
    },
  );
};
