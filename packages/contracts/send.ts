import { canonicalEmail } from "./email-matching";
import {
  isEligibleForSalesCampaign,
  isEligibleForStayInTouch,
  SUPPRESSION_POLICIES,
} from "./suppression";
import type { ContactKind, SuppressionReason } from "./enums";
import type { CampaignSendPurpose } from "./campaign";
import { DISPLAY_TIME_ZONE, zonedLocalToUtc, zonedYmd } from "./time";

export const SEND_BLOCKED_CODE = "SUPPRESSED" as const;
export const SEND_BLOCKED_UNDELIVERABLE_CODE = "UNDELIVERABLE" as const;

// Campaign From is this subdomain only. Operator mail on realmlabs.co
// (nathan@, stefano@, and anyone added later) stays off this reputation.
export const CAMPAIGN_SEND_DOMAIN = "mail.realmlabs.co";
export const CAMPAIGN_FROM_EMAIL_DEFAULT = `hello@${CAMPAIGN_SEND_DOMAIN}`;
export const CAMPAIGN_FROM_NAME_DEFAULT = "Realm Labs";
export const POSTMARK_BROADCAST_STREAM = "broadcast";
export const OUTBOUND_SEND_QUEUE = "outbound.send";
export const OUTBOUND_SEND_JOB_ID = "outbound-drain";
export const SEND_SOFT_BOUNCE_SUPPRESS_AFTER = 3;
export const SEND_WARMUP_DAY1_CAP = 25;
export const SEND_WARMUP_DAILY_INCREMENT = 25;
export const SEND_WARMUP_MAX_CAP = 500;
export const SEND_WINDOW_START_HOUR = 9;
export const SEND_WINDOW_END_HOUR = 18;
export const SEND_TICK_MINUTES = 15;
export const COMPLAINT_RATE_WATCH = 0.001;
export const COMPLAINT_RATE_GMAIL_LIMIT = 0.003;

export type PlanOutboundSendInput = {
  suppressionReason: SuppressionReason | null;
  purpose: CampaignSendPurpose;
  stayInTouch: boolean;
  doNotContact: boolean;
  stayInTouchOptedOut?: boolean;
  emailUndeliverable?: boolean;
  isSeed?: boolean;
  contactKind?: ContactKind;
};

export type PlanOutboundSendResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof SEND_BLOCKED_CODE | typeof SEND_BLOCKED_UNDELIVERABLE_CODE;
      message: string;
    };

export function isCampaignFromAddress(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${CAMPAIGN_SEND_DOMAIN}`);
}

export function planOutboundSend(
  input: PlanOutboundSendInput,
): PlanOutboundSendResult {
  if (input.contactKind === "recruiter") {
    return {
      ok: false,
      code: SEND_BLOCKED_CODE,
      message: "Recruiters are not campaign recipients",
    };
  }
  if (input.doNotContact) {
    return {
      ok: false,
      code: SEND_BLOCKED_CODE,
      message: "Address is suppressed",
    };
  }
  const reason = input.suppressionReason;
  if (reason && SUPPRESSION_POLICIES[reason].blockAllSends) {
    return {
      ok: false,
      code: SEND_BLOCKED_CODE,
      message: "Address is suppressed",
    };
  }
  if (input.isSeed) {
    return { ok: true };
  }
  if (input.emailUndeliverable) {
    return {
      ok: false,
      code: SEND_BLOCKED_UNDELIVERABLE_CODE,
      message: "Address is undeliverable",
    };
  }
  if (input.purpose === "sales") {
    if (
      !isEligibleForSalesCampaign({
        suppressionReason: reason,
        stayInTouch: input.stayInTouch,
        doNotContact: input.doNotContact,
      })
    ) {
      return {
        ok: false,
        code: SEND_BLOCKED_CODE,
        message: "Address is not eligible for sales sends",
      };
    }
    return { ok: true };
  }
  if (
    !isEligibleForStayInTouch({
      suppressionReason: reason,
      stayInTouchOptedOut: input.stayInTouchOptedOut === true,
    })
  ) {
    return {
      ok: false,
      code: SEND_BLOCKED_CODE,
      message: "Address is not eligible for stay-in-touch sends",
    };
  }
  return { ok: true };
}

/**
 * Call this immediately before handing a queued row to the provider.
 * Enqueue already ran the same gate; an unsubscribe can land while the
 * row sits in the queue, and that window is where complaints come from.
 */
export function planOutboundDeliver(
  input: PlanOutboundSendInput,
): PlanOutboundSendResult {
  return planOutboundSend(input);
}

export function dailySendCap(warmupDayIndex: number): number {
  const day = Math.max(0, Math.floor(warmupDayIndex));
  const cap = SEND_WARMUP_DAY1_CAP + day * SEND_WARMUP_DAILY_INCREMENT;
  return Math.min(SEND_WARMUP_MAX_CAP, cap);
}

export function sendTickBudget(input: {
  dailyCap: number;
  alreadySentToday: number;
  queued: number;
  remainingTicksInWindow: number;
}): number {
  const remainingCap = Math.max(0, input.dailyCap - input.alreadySentToday);
  if (remainingCap === 0 || input.queued === 0) {
    return 0;
  }
  const ticks = Math.max(1, input.remainingTicksInWindow);
  const spread = Math.ceil(input.queued / ticks);
  return Math.min(remainingCap, input.queued, Math.max(1, spread));
}

export function parseSeedEmails(raw: string): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed.includes("@")) {
      continue;
    }
    const email = canonicalEmail(trimmed);
    if (!email.includes("@") || seen.has(email)) {
      continue;
    }
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

export function remainingSendTicksInWindow(
  now: Date,
  timeZone: string = DISPLAY_TIME_ZONE,
): number {
  const ymd = zonedYmd(now, timeZone);
  const windowStart = zonedLocalToUtc(
    ymd,
    timeZone,
    SEND_WINDOW_START_HOUR,
    0,
    0,
  );
  const windowEnd = zonedLocalToUtc(
    ymd,
    timeZone,
    SEND_WINDOW_END_HOUR,
    0,
    0,
  );
  if (
    now.getTime() < windowStart.getTime() ||
    now.getTime() >= windowEnd.getTime()
  ) {
    return 0;
  }
  const ms = windowEnd.getTime() - now.getTime();
  return Math.max(1, Math.ceil(ms / (SEND_TICK_MINUTES * 60 * 1000)));
}


