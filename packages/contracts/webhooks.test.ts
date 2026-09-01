import { describe, expect, it } from "vitest";
import {
  applicationWebhookBodySchema,
  decideApplicationWebhook,
  decideStripeCheckout,
  isApplicationWebhookEligibleStage,
  isFeatureFlagOn,
  matchPersonEmail,
  personNamesFromApplication,
  serializeApplicationResult,
  stripeAmountToUsd,
  stripeCheckoutSessionSchema,
  stripeEventSchema,
  STRIPE_CHECKOUT_SESSION_COMPLETED,
  type WebhookCard,
  type WebhookPerson,
} from "./webhooks";

const CARD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PERSON_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function card(overrides: Partial<WebhookCard> = {}): WebhookCard {
  return {
    id: CARD_ID,
    personId: PERSON_ID,
    stage: "sent",
    applicationRef: null,
    priceUsd: null,
    ...overrides,
  };
}

function person(overrides: Partial<WebhookPerson> = {}): WebhookPerson {
  return {
    id: PERSON_ID,
    email: "ada@example.com",
    incubatorCard: card(),
    ...overrides,
  };
}

describe("application webhook payload", () => {
  it("requires email, application_ref, and answers, and lowercases email", () => {
    const parsed = applicationWebhookBodySchema.parse({
      email: "Ada@Example.COM",
      application_ref: " APP-1 ",
      answers: { track: "builders" },
    });
    expect(parsed).toEqual({
      email: "ada@example.com",
      application_ref: "APP-1",
      answers: { track: "builders" },
    });
  });

  it("serializes answers as JSON for application_result", () => {
    expect(serializeApplicationResult({ q1: "yes", q2: 3 })).toBe(
      '{"q1":"yes","q2":3}',
    );
  });
});

describe("application webhook email matching", () => {
  it("matches people.email case-insensitively", () => {
    expect(matchPersonEmail("Ada@Example.com", "ada@example.com")).toBe(true);
    expect(matchPersonEmail("ada@example.com", "other@example.com")).toBe(false);
  });
});

describe("decideApplicationWebhook", () => {
  it("is idempotent on application_ref", () => {
    expect(
      decideApplicationWebhook({
        applicationRef: "APP-1",
        cardByRef: card({ applicationRef: "APP-1", stage: "applied" }),
        personByEmail: person(),
      }),
    ).toEqual({
      action: "idempotent",
      personId: PERSON_ID,
      cardId: CARD_ID,
      needsReview: false,
    });
  });

  it("updates a person whose incubator card is Routed", () => {
    expect(
      decideApplicationWebhook({
        applicationRef: "APP-1",
        cardByRef: null,
        personByEmail: person({ incubatorCard: card({ stage: "sent" }) }),
      }),
    ).toEqual({
      action: "update",
      personId: PERSON_ID,
      cardId: CARD_ID,
      fromStage: "sent",
      needsReview: false,
    });
  });

  it("updates a person whose incubator card is Application Sent", () => {
    expect(isApplicationWebhookEligibleStage("sent")).toBe(true);
    expect(
      decideApplicationWebhook({
        applicationRef: "APP-1",
        cardByRef: null,
        personByEmail: person({
          incubatorCard: card({ stage: "sent" }),
        }),
      }),
    ).toMatchObject({ action: "update", fromStage: "sent" });
  });

  it("creates and flags for review when no person exists", () => {
    expect(
      decideApplicationWebhook({
        applicationRef: "APP-1",
        cardByRef: null,
        personByEmail: null,
      }),
    ).toEqual({ action: "create", needsReview: true });
  });

  it("flags for review when a person exists without an eligible incubator card", () => {
    expect(
      decideApplicationWebhook({
        applicationRef: "APP-1",
        cardByRef: null,
        personByEmail: person({
          incubatorCard: card({ stage: "approved" }),
        }),
      }),
    ).toEqual({
      action: "flag",
      personId: PERSON_ID,
      cardId: CARD_ID,
      fromStage: "approved",
      needsReview: true,
    });
    expect(
      decideApplicationWebhook({
        applicationRef: "APP-1",
        cardByRef: null,
        personByEmail: person({ incubatorCard: null }),
      }),
    ).toMatchObject({ action: "flag", cardId: null, needsReview: true });
  });
});

describe("personNamesFromApplication", () => {
  it("uses supplied names and placeholders when omitted", () => {
    expect(
      personNamesFromApplication({
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
      }),
    ).toEqual({ firstName: "Ada", lastName: "Lovelace" });
    expect(
      personNamesFromApplication({ email: "ada@example.com" }),
    ).toEqual({ firstName: "Unknown", lastName: "Unknown" });
  });
});

describe("STRIPE_ENABLED flag", () => {
  it("defaults off", () => {
    expect(isFeatureFlagOn(undefined)).toBe(false);
    expect(isFeatureFlagOn("")).toBe(false);
    expect(isFeatureFlagOn("false")).toBe(false);
    expect(isFeatureFlagOn("true")).toBe(true);
    expect(isFeatureFlagOn("1")).toBe(true);
  });
});

describe("decideStripeCheckout", () => {
  it("stays disabled when the feature flag is off", () => {
    expect(
      decideStripeCheckout({
        enabled: false,
        eventType: STRIPE_CHECKOUT_SESSION_COMPLETED,
        customerEmail: "ada@example.com",
        amountTotal: 500000,
        card: card({ stage: "applied", priceUsd: 5000 }),
      }),
    ).toEqual({ action: "disabled" });
  });

  it("ignores events other than checkout.session.completed", () => {
    expect(
      decideStripeCheckout({
        enabled: true,
        eventType: "customer.created",
        customerEmail: "ada@example.com",
        amountTotal: 500000,
        card: card({ stage: "applied" }),
      }),
    ).toEqual({ action: "ignore" });
  });

  it("matches customer_email to an offer_made card and sets price_usd from amount_total", () => {
    expect(stripeAmountToUsd(500000)).toBe(5000);
    expect(
      decideStripeCheckout({
        enabled: true,
        eventType: STRIPE_CHECKOUT_SESSION_COMPLETED,
        customerEmail: "Ada@Example.COM",
        amountTotal: 500000,
        card: card({ stage: "applied", priceUsd: 5000 }),
      }),
    ).toEqual({
      action: "paid",
      personId: PERSON_ID,
      cardId: CARD_ID,
      fromStage: "applied",
      priceUsd: 5000,
    });
  });

  it("ignores checkout when no applied card matches", () => {
    expect(
      decideStripeCheckout({
        enabled: true,
        eventType: STRIPE_CHECKOUT_SESSION_COMPLETED,
        customerEmail: "ada@example.com",
        amountTotal: 500000,
        card: card({ stage: "sent" }),
      }),
    ).toEqual({ action: "ignore" });
    expect(
      decideStripeCheckout({
        enabled: true,
        eventType: STRIPE_CHECKOUT_SESSION_COMPLETED,
        customerEmail: "ada@example.com",
        amountTotal: 500000,
        card: null,
      }),
    ).toEqual({ action: "ignore" });
  });
});

describe("stripe event schemas", () => {
  it("reads customer_email and amount_total from a checkout session", () => {
    const event = stripeEventSchema.parse({
      id: "evt_1",
      type: STRIPE_CHECKOUT_SESSION_COMPLETED,
      data: {
        object: {
          id: "cs_1",
          object: "checkout.session",
          customer_email: "Ada@Example.COM",
          amount_total: 100000,
          extra: true,
        },
      },
    });
    const session = stripeCheckoutSessionSchema.parse(event.data.object);
    expect(session.customer_email).toBe("ada@example.com");
    expect(session.amount_total).toBe(100000);
  });
});
