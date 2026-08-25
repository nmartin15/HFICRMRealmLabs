import { z } from "zod";
import { emailSchema, uuidSchema, type IncubatorStage } from "./enums";
import { normalizeEmail } from "./hosted-domain";

export const APPLICATION_WEBHOOK_SECRET_HEADER = "x-webhook-secret";
export const STRIPE_SIGNATURE_HEADER = "stripe-signature";
export const STRIPE_CHECKOUT_SESSION_COMPLETED = "checkout.session.completed";

export const APPLICATION_WEBHOOK_ELIGIBLE_STAGES = [
  "routed",
  "application_sent",
] as const;
export type ApplicationWebhookEligibleStage =
  (typeof APPLICATION_WEBHOOK_ELIGIBLE_STAGES)[number];

export const WEBHOOK_ACTOR = {
  id: "webhook",
  email: "webhook@realmlabs.co",
} as const;

export const UNKNOWN_PERSON_NAME = "Unknown";

export const APPLICATION_WEBHOOK_REVIEW_NOTE =
  "Needs review: created from application form webhook (no matching person).";

export function isApplicationWebhookEligibleStage(
  stage: IncubatorStage,
): stage is ApplicationWebhookEligibleStage {
  return (APPLICATION_WEBHOOK_ELIGIBLE_STAGES as readonly string[]).includes(
    stage,
  );
}

export function isFeatureFlagOn(
  value: string | boolean | undefined | null,
): boolean {
  if (value === true) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export const applicationAnswersSchema = z.record(z.string(), z.unknown());
export type ApplicationAnswers = z.infer<typeof applicationAnswersSchema>;

export const applicationWebhookBodySchema = z.object({
  email: emailSchema.transform((value) => normalizeEmail(value)),
  application_ref: z.string().trim().min(1),
  answers: applicationAnswersSchema,
  first_name: z.string().trim().min(1).optional(),
  last_name: z.string().trim().min(1).optional(),
});
export type ApplicationWebhookBody = z.infer<typeof applicationWebhookBodySchema>;

export const applicationWebhookResponseSchema = z.object({
  received: z.literal(true),
  idempotent: z.boolean(),
  personId: uuidSchema,
  incubatorCardId: uuidSchema.nullable(),
  needsReview: z.boolean(),
});
export type ApplicationWebhookResponse = z.infer<
  typeof applicationWebhookResponseSchema
>;

export const stripeWebhookResponseSchema = z.object({
  received: z.literal(true),
});
export type StripeWebhookResponse = z.infer<typeof stripeWebhookResponseSchema>;

export const stripeCheckoutSessionSchema = z
  .object({
    id: z.string().optional(),
    object: z.string().optional(),
    customer_email: z
      .string()
      .nullable()
      .optional()
      .transform((value) => (value ? normalizeEmail(value) : value)),
    amount_total: z.number().int().nullable().optional(),
  })
  .loose();
export type StripeCheckoutSession = z.infer<typeof stripeCheckoutSessionSchema>;

export const stripeEventSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    data: z.object({
      object: z.unknown(),
    }),
  })
  .loose();
export type StripeEvent = z.infer<typeof stripeEventSchema>;

export function serializeApplicationResult(
  answers: ApplicationAnswers,
): string {
  return JSON.stringify(answers);
}

export function stripeAmountToUsd(amountTotal: number): number {
  return Math.floor(amountTotal / 100);
}

export function personNamesFromApplication(input: {
  firstName?: string;
  lastName?: string;
  email: string;
}): { firstName: string; lastName: string } {
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  // TODO: application form may omit names; placeholders keep people.first_name/last_name NOT NULL.
  return {
    firstName: firstName && firstName.length > 0 ? firstName : UNKNOWN_PERSON_NAME,
    lastName: lastName && lastName.length > 0 ? lastName : UNKNOWN_PERSON_NAME,
  };
}

export type WebhookCard = {
  id: string;
  personId: string;
  stage: IncubatorStage;
  applicationRef: string | null;
  priceUsd: number | null;
};

export type WebhookPerson = {
  id: string;
  email: string;
  incubatorCard: WebhookCard | null;
};

export type ApplicationWebhookDecision =
  | {
      action: "idempotent";
      personId: string;
      cardId: string;
      needsReview: boolean;
    }
  | {
      action: "update";
      personId: string;
      cardId: string;
      fromStage: ApplicationWebhookEligibleStage;
      needsReview: false;
    }
  | {
      action: "create";
      needsReview: true;
    }
  | {
      action: "flag";
      personId: string;
      cardId: string | null;
      fromStage: IncubatorStage | null;
      needsReview: true;
    };

export function decideApplicationWebhook(input: {
  applicationRef: string;
  cardByRef: WebhookCard | null;
  personByEmail: WebhookPerson | null;
}): ApplicationWebhookDecision {
  if (input.cardByRef) {
    return {
      action: "idempotent",
      personId: input.cardByRef.personId,
      cardId: input.cardByRef.id,
      needsReview: false,
    };
  }

  const person = input.personByEmail;
  if (!person) {
    return { action: "create", needsReview: true };
  }

  const card = person.incubatorCard;
  if (card && isApplicationWebhookEligibleStage(card.stage)) {
    return {
      action: "update",
      personId: person.id,
      cardId: card.id,
      fromStage: card.stage,
      needsReview: false,
    };
  }

  return {
    action: "flag",
    personId: person.id,
    cardId: card?.id ?? null,
    fromStage: card?.stage ?? null,
    needsReview: true,
  };
}

export type StripeWebhookDecision =
  | { action: "disabled" }
  | { action: "ignore" }
  | {
      action: "paid";
      personId: string;
      cardId: string;
      fromStage: "offer_made";
      priceUsd: number;
    };

export function decideStripeCheckout(input: {
  enabled: boolean;
  eventType: string;
  customerEmail: string | null | undefined;
  amountTotal: number | null | undefined;
  card: WebhookCard | null;
}): StripeWebhookDecision {
  if (!input.enabled) {
    return { action: "disabled" };
  }
  if (input.eventType !== STRIPE_CHECKOUT_SESSION_COMPLETED) {
    return { action: "ignore" };
  }
  const email = input.customerEmail ? normalizeEmail(input.customerEmail) : "";
  if (!email) {
    return { action: "ignore" };
  }
  if (input.amountTotal === null || input.amountTotal === undefined) {
    return { action: "ignore" };
  }
  if (!input.card || input.card.stage !== "offer_made") {
    return { action: "ignore" };
  }
  return {
    action: "paid",
    personId: input.card.personId,
    cardId: input.card.id,
    fromStage: "offer_made",
    priceUsd: stripeAmountToUsd(input.amountTotal),
  };
}

export function matchPersonEmail(
  storedEmail: string,
  incomingEmail: string,
): boolean {
  return normalizeEmail(storedEmail) === normalizeEmail(incomingEmail);
}
