import { z } from "zod";
import { uuidSchema, type SuppressionReason } from "./enums";
import type { CampaignSendPurpose } from "./campaign";
import { canonicalEmail } from "./email-matching";
import { SEND_SOFT_BOUNCE_SUPPRESS_AFTER } from "./send";
import { SUPPRESSION_POLICIES } from "./suppression";

export const POSTMARK_HARD_BOUNCE_TYPES = new Set([
  "HardBounce",
  "BadEmailAddress",
  "Blocked",
  "ManuallyDeactivated",
  "Unconfirmed",
  "DMARCPolicy",
]);

export const POSTMARK_SOFT_BOUNCE_TYPES = new Set([
  "Transient",
  "SoftBounce",
  "DnsError",
  "Unknown",
]);

const postmarkEventBaseSchema = z
  .object({
    RecordType: z.string().min(1),
    MessageID: z.string().optional(),
    Email: z.string().optional(),
    Recipient: z.string().optional(),
    Type: z.string().optional(),
    Description: z.string().optional(),
    Details: z.string().optional(),
    BouncedAt: z.string().optional(),
    ChangedAt: z.string().optional(),
    SuppressSending: z.boolean().optional(),
    SuppressionReason: z.string().optional(),
    Origin: z.string().optional(),
    Tag: z.string().optional(),
    Metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type PostmarkWebhookEvent = z.infer<typeof postmarkEventBaseSchema>;

export const unsubscribeParamsSchema = z.object({
  token: uuidSchema,
});
export type UnsubscribeParams = z.infer<typeof unsubscribeParamsSchema>;

/** RFC 8058 one-click and the confirmation form POST. GET must never write. */
export type UnsubscribeHttpAction = "confirm" | "write";

export function unsubscribeHttpAction(
  method: string,
): UnsubscribeHttpAction {
  return method.toUpperCase() === "POST" ? "write" : "confirm";
}

export type PlannedPostmarkAction =
  | { kind: "ignore" }
  | {
      kind: "delivery";
      email: string;
      messageId: string | null;
    }
  | {
      kind: "hard_bounce";
      email: string;
      messageId: string | null;
      reason: Extract<SuppressionReason, "hard_bounced">;
    }
  | {
      kind: "soft_bounce";
      email: string;
      messageId: string | null;
    }
  | {
      kind: "complaint";
      email: string;
      messageId: string | null;
      reason: Extract<SuppressionReason, "complained">;
    }
  | {
      kind: "unsubscribe";
      email: string;
      messageId: string | null;
      reason: Extract<SuppressionReason, "unsubscribed">;
    }
  | {
      kind: "stay_in_touch_opt_out";
      email: string;
      messageId: string | null;
    };

export function duplicatePostmarkNeedsTombstone(input: {
  kind: PlannedPostmarkAction["kind"];
  currentReason: SuppressionReason | null;
}): boolean {
  if (
    input.kind !== "hard_bounce" &&
    input.kind !== "complaint" &&
    input.kind !== "unsubscribe"
  ) {
    return false;
  }
  if (!input.currentReason) {
    return true;
  }
  return !SUPPRESSION_POLICIES[input.currentReason].blockAllSends;
}

export function parsePostmarkWebhookEvent(
  body: unknown,
): PostmarkWebhookEvent | null {
  const parsed = postmarkEventBaseSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

function eventEmail(event: PostmarkWebhookEvent): string | null {
  const raw = event.Email ?? event.Recipient;
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  return canonicalEmail(raw);
}

function purposeFromMetadata(
  event: PostmarkWebhookEvent,
): CampaignSendPurpose | null {
  const raw = event.Metadata?.purpose;
  if (raw === "sales" || raw === "newsletter" || raw === "value_add") {
    return raw;
  }
  return null;
}

function planUnsubscribeAction(
  email: string,
  messageId: string | null,
  purpose: CampaignSendPurpose | null,
): PlannedPostmarkAction {
  if (purpose === "newsletter") {
    return { kind: "stay_in_touch_opt_out", email, messageId };
  }
  return { kind: "unsubscribe", email, messageId, reason: "unsubscribed" };
}

export function unsubscribeConfirmCopy(purpose: CampaignSendPurpose | null): {
  title: string;
  prompt: string;
} {
  if (purpose === "newsletter") {
    return {
      title: "Unsubscribe",
      prompt: "Stop stay-in-touch email from Realm Labs to this address?",
    };
  }
  return {
    title: "Unsubscribe",
    prompt: "Stop email from Realm Labs to this address?",
  };
}

export function planPostmarkWebhook(
  event: PostmarkWebhookEvent,
): PlannedPostmarkAction {
  const email = eventEmail(event);
  const messageId = event.MessageID?.trim() ? event.MessageID : null;
  if (!email) {
    return { kind: "ignore" };
  }

  if (event.RecordType === "Delivery") {
    return { kind: "delivery", email, messageId };
  }

  if (event.RecordType === "SpamComplaint") {
    return { kind: "complaint", email, messageId, reason: "complained" };
  }

  if (event.RecordType === "SubscriptionChange") {
    if (event.SuppressSending === false) {
      return { kind: "ignore" };
    }
    if (event.SuppressionReason === "HardBounce") {
      return { kind: "hard_bounce", email, messageId, reason: "hard_bounced" };
    }
    if (event.SuppressionReason === "SpamComplaint") {
      return { kind: "complaint", email, messageId, reason: "complained" };
    }
    return planUnsubscribeAction(email, messageId, purposeFromMetadata(event));
  }

  if (event.RecordType !== "Bounce") {
    return { kind: "ignore" };
  }

  const type = event.Type ?? "";
  if (type === "Unsubscribe") {
    return planUnsubscribeAction(email, messageId, purposeFromMetadata(event));
  }
  if (type === "SpamComplaint" || type === "SpamNotification") {
    return { kind: "complaint", email, messageId, reason: "complained" };
  }
  if (POSTMARK_HARD_BOUNCE_TYPES.has(type)) {
    return { kind: "hard_bounce", email, messageId, reason: "hard_bounced" };
  }
  if (POSTMARK_SOFT_BOUNCE_TYPES.has(type)) {
    return { kind: "soft_bounce", email, messageId };
  }
  return { kind: "hard_bounce", email, messageId, reason: "hard_bounced" };
}

export function planSoftBounceSuppress(count: number): boolean {
  return count >= SEND_SOFT_BOUNCE_SUPPRESS_AFTER;
}
