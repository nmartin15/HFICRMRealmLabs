import {
  APPLICATION_WEBHOOK_REVIEW_NOTE,
  APPLICATION_WEBHOOK_SECRET_HEADER,
  STRIPE_SIGNATURE_HEADER,
  WEBHOOK_ACTOR,
  applicationWebhookBodySchema,
  applicationWebhookResponseSchema,
  decideApplicationWebhook,
  decideStripeCheckout,
  personNamesFromApplication,
  serializeApplicationResult,
  stripeCheckoutSessionSchema,
  stripeEventSchema,
  stripeWebhookResponseSchema,
  STRIPE_CHECKOUT_SESSION_COMPLETED,
  type ApplicationWebhookBody,
  type WebhookCard,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { eq } from "drizzle-orm";
import {
  incubatorCards,
  people,
  type Database,
} from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import { secretsEqual } from "../lib/secrets.js";
import { verifyStripeSignature } from "../lib/stripe-signature.js";
import { httpError } from "../plugins/error.js";

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function toWebhookCard(
  row: typeof incubatorCards.$inferSelect,
): WebhookCard {
  return {
    id: row.id,
    personId: row.personId,
    stage: row.stage,
    applicationRef: row.applicationRef,
    priceUsd: row.priceUsd,
  };
}

async function cardByApplicationRef(db: Database, applicationRef: string) {
  const rows = await db
    .select()
    .from(incubatorCards)
    .where(eq(incubatorCards.applicationRef, applicationRef))
    .limit(1);
  return rows[0] ?? null;
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
    .select()
    .from(incubatorCards)
    .where(eq(incubatorCards.personId, person.id))
    .limit(1);
  return {
    person,
    card: cardRows[0] ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ("code" in current && current.code === "23505") {
      return true;
    }
    current =
      "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
  }
  return false;
}

async function writeWebhookActivity(
  db: Database,
  input: {
    personId: string;
    what: "webhook.application" | "webhook.stripe";
    when: Date;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  },
) {
  await writeActivity(db, {
    personId: input.personId,
    userId: null,
    type: "webhook",
    payload: {
      who: { id: WEBHOOK_ACTOR.id, email: WEBHOOK_ACTOR.email },
      what: input.what,
      when: input.when.toISOString(),
      before: input.before,
      after: input.after,
    },
  });
}

async function writeIncubatorStageChange(
  db: Database,
  input: {
    personId: string;
    when: Date;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  },
) {
  await writeActivity(db, {
    personId: input.personId,
    userId: null,
    type: "stage_change",
    payload: {
      who: { id: WEBHOOK_ACTOR.id, email: WEBHOOK_ACTOR.email },
      what: "incubator.stage_change",
      when: input.when.toISOString(),
      before: input.before,
      after: input.after,
    },
  });
}

async function handleApplicationPayload(
  db: Database,
  body: ApplicationWebhookBody,
  retried = false,
) {
  const when = new Date();
  const answersJson = serializeApplicationResult(body.answers);
  const matched = await personByEmail(db, body.email);
  const existingRef = await cardByApplicationRef(db, body.application_ref);
  const decision = decideApplicationWebhook({
    applicationRef: body.application_ref,
    cardByRef: existingRef ? toWebhookCard(existingRef) : null,
    personByEmail: matched
      ? {
          id: matched.person.id,
          email: matched.person.email,
          incubatorCard: matched.card ? toWebhookCard(matched.card) : null,
        }
      : null,
  });

  if (decision.action === "idempotent") {
    return applicationWebhookResponseSchema.parse({
      received: true,
      idempotent: true,
      personId: decision.personId,
      incubatorCardId: decision.cardId,
      needsReview: decision.needsReview,
    });
  }

  if (decision.action === "update") {
    const current = matched?.card;
    if (!current) {
      throw httpError(500, "INTERNAL", "Incubator card not found");
    }
    const names = personNamesFromApplication({
      firstName: body.first_name,
      lastName: body.last_name,
      email: body.email,
    });
    const needsReview = names.usedPlaceholder;
    const updated = await db.transaction(async (tx) => {
      const typedTx = tx as unknown as Database;
      if (needsReview) {
        await typedTx
          .update(people)
          .set({ needsReview: true })
          .where(eq(people.id, current.personId));
      }
      const [row] = await typedTx
        .update(incubatorCards)
        .set({
          stage: "applied",
          applicationRef: body.application_ref,
          applicationResult: answersJson,
        })
        .where(eq(incubatorCards.id, current.id))
        .returning();
      if (!row) {
        throw httpError(404, "NOT_FOUND", "Incubator card not found");
      }

      await writeIncubatorStageChange(typedTx, {
        personId: current.personId,
        when,
        before: {
          stage: current.stage,
          applicationRef: current.applicationRef,
        },
        after: {
          stage: "applied",
          applicationRef: body.application_ref,
        },
      });
      await writeWebhookActivity(typedTx, {
        personId: current.personId,
        what: "webhook.application",
        when,
        before: {
          stage: current.stage,
          applicationRef: current.applicationRef,
          applicationResult: current.applicationResult,
        },
        after: {
          stage: "applied",
          applicationRef: body.application_ref,
          applicationResult: answersJson,
        },
      });
      return row;
    });

    return applicationWebhookResponseSchema.parse({
      received: true,
      idempotent: false,
      personId: current.personId,
      incubatorCardId: updated.id,
      needsReview,
    });
  }

  if (decision.action === "flag") {
    await db
      .update(people)
      .set({ needsReview: true })
      .where(eq(people.id, decision.personId));
    await writeWebhookActivity(db, {
      personId: decision.personId,
      what: "webhook.application",
      when,
      before: {
        stage: decision.fromStage,
        applicationRef: matched?.card?.applicationRef ?? null,
      },
      after: {
        applicationRef: body.application_ref,
        applicationResult: answersJson,
        needsReview: true,
      },
    });
    return applicationWebhookResponseSchema.parse({
      received: true,
      idempotent: false,
      personId: decision.personId,
      incubatorCardId: decision.cardId,
      needsReview: true,
    });
  }

  const names = personNamesFromApplication({
    firstName: body.first_name,
    lastName: body.last_name,
    email: body.email,
  });

  try {
    const created = await db.transaction(async (tx) => {
      const typedTx = tx as unknown as Database;
      const [createdPerson] = await typedTx
        .insert(people)
        .values({
          firstName: names.firstName,
          lastName: names.lastName,
          email: body.email,
          source: "other",
          notes: APPLICATION_WEBHOOK_REVIEW_NOTE,
          needsReview: names.usedPlaceholder,
        })
        .returning();
      if (!createdPerson) {
        throw httpError(500, "INTERNAL", "Failed to create person");
      }

      const [createdCard] = await typedTx
        .insert(incubatorCards)
        .values({
          personId: createdPerson.id,
          stage: "applied",
          applicationRef: body.application_ref,
          applicationResult: answersJson,
          routedAt: when,
        })
        .returning();
      if (!createdCard) {
        throw httpError(500, "INTERNAL", "Failed to create incubator card");
      }

      await writeWebhookActivity(typedTx, {
        personId: createdPerson.id,
        what: "webhook.application",
        when,
        before: null,
        after: {
          stage: "applied",
          applicationRef: body.application_ref,
          applicationResult: answersJson,
          source: "other",
          needsReview: names.usedPlaceholder,
        },
      });

      return { person: createdPerson, card: createdCard };
    });

    return applicationWebhookResponseSchema.parse({
      received: true,
      idempotent: false,
      personId: created.person.id,
      incubatorCardId: created.card.id,
      needsReview: names.usedPlaceholder,
    });
  } catch (err) {
    if (!isUniqueViolation(err) || retried) {
      throw err;
    }
    return handleApplicationPayload(db, body, true);
  }
}

export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/webhooks/application",
    {
      schema: {
        body: applicationWebhookBodySchema,
        response: { 200: applicationWebhookResponseSchema },
      },
    },
    async (req) => {
      const expected = app.env.APPLICATION_WEBHOOK_SECRET;
      if (!expected) {
        throw httpError(
          503,
          "WEBHOOK_NOT_CONFIGURED",
          "Application webhook secret is not configured",
        );
      }
      const provided = headerValue(req.headers[APPLICATION_WEBHOOK_SECRET_HEADER]);
      if (!provided || !secretsEqual(provided, expected)) {
        throw httpError(401, "UNAUTHORIZED", "Invalid webhook secret");
      }
      return handleApplicationPayload(app.db, req.body);
    },
  );

  app.post(
    "/webhooks/stripe",
    {
      schema: {
        body: stripeEventSchema,
        response: { 200: stripeWebhookResponseSchema },
      },
    },
    async (req) => {
      if (!app.env.STRIPE_ENABLED) {
        throw httpError(404, "STRIPE_DISABLED", "Stripe webhooks are disabled");
      }
      const secret = app.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        throw httpError(
          503,
          "STRIPE_NOT_CONFIGURED",
          "Stripe webhook secret is not configured",
        );
      }
      const payload = req.rawBody;
      if (!payload) {
        throw httpError(400, "INVALID_BODY", "Missing raw request body");
      }
      const signature = verifyStripeSignature({
        payload,
        header: headerValue(req.headers[STRIPE_SIGNATURE_HEADER]),
        secret,
      });
      if (!signature.ok) {
        throw httpError(
          401,
          "STRIPE_SIGNATURE_INVALID",
          "Invalid Stripe signature",
        );
      }

      const event = stripeEventSchema.parse(req.body);
      let session: ReturnType<typeof stripeCheckoutSessionSchema.parse> | null =
        null;
      if (event.type === STRIPE_CHECKOUT_SESSION_COMPLETED) {
        const parsed = stripeCheckoutSessionSchema.safeParse(event.data.object);
        session = parsed.success ? parsed.data : null;
      }

      const email = session?.customer_email ?? null;
      const matched = email ? await personByEmail(app.db, email) : null;
      const decision = decideStripeCheckout({
        enabled: true,
        eventType: event.type,
        customerEmail: email,
        amountTotal: session?.amount_total ?? null,
        card: matched?.card ? toWebhookCard(matched.card) : null,
      });

      if (decision.action === "paid" && matched?.card) {
        const current = matched.card;
        const when = new Date();
        await app.db.transaction(async (tx) => {
          const typedTx = tx as unknown as Database;
          const [updated] = await typedTx
            .update(incubatorCards)
            .set({
              stage: "approved",
              priceUsd: decision.priceUsd,
            })
            .where(eq(incubatorCards.id, current.id))
            .returning();
          if (!updated) {
            throw httpError(404, "NOT_FOUND", "Incubator card not found");
          }

          await writeIncubatorStageChange(typedTx, {
            personId: current.personId,
            when,
            before: { stage: current.stage, priceUsd: current.priceUsd },
            after: { stage: "approved", priceUsd: decision.priceUsd },
          });
          await writeWebhookActivity(typedTx, {
            personId: current.personId,
            what: "webhook.stripe",
            when,
            before: { stage: current.stage, priceUsd: current.priceUsd },
            after: {
              stage: "approved",
              priceUsd: decision.priceUsd,
              eventId: event.id,
            },
          });
        });
      }

      return stripeWebhookResponseSchema.parse({ received: true });
    },
  );
};
