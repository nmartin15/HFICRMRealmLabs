import {
  okResponseSchema,
  unsubscribeHttpAction,
  unsubscribeParamsSchema,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { eq } from "drizzle-orm";
import { findPersonByEmail, outboundSends, type Database } from "@realm-labs/db";
import { basicAuthMatches } from "../lib/basic-auth.js";
import { applyPostmarkWebhook } from "../lib/postmark-events.js";
import { writeSuppression } from "../lib/suppression.js";
import { httpError } from "../plugins/error.js";

export function unsubscribeConfirmationHtml(): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Unsubscribe</title>
<body>
  <p>Stop email from Realm Labs to this address?</p>
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
        .send(unsubscribeConfirmationHtml());
    },
  );
};
