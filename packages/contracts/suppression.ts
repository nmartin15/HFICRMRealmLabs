import { z } from "zod";
import { canonicalEmail } from "./email-matching";
import {
  isoDateTimeSchema,
  suppressionReasonSchema,
  suppressionSourceSchema,
  uuidSchema,
  type SuppressionReason,
  type SuppressionSource,
} from "./enums";

export const EMAIL_HASH_HEX_LENGTH = 64;

export const emailHashSchema = z
  .string()
  .length(EMAIL_HASH_HEX_LENGTH)
  .regex(/^[0-9a-f]+$/);

export const suppressionSourceTextSchema = suppressionSourceSchema;

export type SuppressionListVisibility = "hidden" | "gone" | "visible";

export type SuppressionPolicy = {
  purgePerson: boolean;
  blockAllSends: boolean;
  blockSalesCampaigns: boolean;
  blockNewsletter: boolean;
  listVisibility: SuppressionListVisibility;
};

export const SUPPRESSION_POLICIES: Record<SuppressionReason, SuppressionPolicy> =
  {
    unsubscribed: {
      purgePerson: true,
      blockAllSends: true,
      blockSalesCampaigns: true,
      blockNewsletter: true,
      listVisibility: "gone",
    },
    complained: {
      purgePerson: true,
      blockAllSends: true,
      blockSalesCampaigns: true,
      blockNewsletter: true,
      listVisibility: "gone",
    },
    do_not_contact: {
      purgePerson: false,
      blockAllSends: true,
      blockSalesCampaigns: true,
      blockNewsletter: true,
      listVisibility: "hidden",
    },
    hard_bounced: {
      purgePerson: false,
      blockAllSends: true,
      blockSalesCampaigns: true,
      blockNewsletter: true,
      listVisibility: "visible",
    },
    rejected: {
      purgePerson: false,
      blockAllSends: false,
      blockSalesCampaigns: true,
      blockNewsletter: false,
      listVisibility: "visible",
    },
    enrolled: {
      purgePerson: false,
      blockAllSends: false,
      blockSalesCampaigns: true,
      blockNewsletter: false,
      listVisibility: "visible",
    },
  };

export const SUPPRESSION_REASON_RANK: Record<SuppressionReason, number> = {
  complained: 5,
  unsubscribed: 5,
  do_not_contact: 4,
  hard_bounced: 3,
  rejected: 2,
  enrolled: 2,
};

export function suppressionReasonRank(reason: SuppressionReason): number {
  return SUPPRESSION_REASON_RANK[reason];
}

export function winningSuppressionReason(
  current: SuppressionReason | null,
  incoming: SuppressionReason,
): SuppressionReason {
  if (!current) {
    return incoming;
  }
  if (suppressionReasonRank(incoming) > suppressionReasonRank(current)) {
    return incoming;
  }
  if (suppressionReasonRank(incoming) < suppressionReasonRank(current)) {
    return current;
  }
  return incoming;
}

export const PURGE_STEP_ORDER = [
  "upsert_suppression",
  "insert_suppression_event",
  "unlink_email_threads",
  "delete_person_graph",
  "set_purged_at",
] as const;
export type PurgeStep = (typeof PURGE_STEP_ORDER)[number];

export const emailSuppressionSchema = z.object({
  id: uuidSchema,
  emailHash: emailHashSchema,
  reason: suppressionReasonSchema,
  source: suppressionSourceSchema,
  occurredAt: isoDateTimeSchema,
  purgedAt: isoDateTimeSchema.nullable(),
  createdBy: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type EmailSuppression = z.infer<typeof emailSuppressionSchema>;

export type PlanSuppressionWriteInput = {
  currentReason: SuppressionReason | null;
  incomingReason: SuppressionReason;
  alreadyPurged: boolean;
};

export type PlanSuppressionWriteResult = {
  upsertTombstone: true;
  insertEvent: true;
  nextReason: SuppressionReason;
  reasonChanged: boolean;
  purgePerson: boolean;
  setDoNotContact: boolean;
};

export function planSuppressionWrite(
  input: PlanSuppressionWriteInput,
): PlanSuppressionWriteResult {
  const nextReason = winningSuppressionReason(
    input.currentReason,
    input.incomingReason,
  );
  const policy = SUPPRESSION_POLICIES[nextReason];
  return {
    upsertTombstone: true,
    insertEvent: true,
    nextReason,
    reasonChanged: nextReason !== input.currentReason,
    purgePerson: policy.purgePerson && !input.alreadyPurged,
    setDoNotContact: nextReason === "do_not_contact" || policy.purgePerson,
  };
}

export type PlanDoNotContactChangeInput = {
  currentlyDoNotContact: boolean;
  nextDoNotContact: boolean;
};

export type PlanDoNotContactChangeResult =
  | {
      ok: true;
      writeSuppression: true;
      reason: "do_not_contact";
      setDoNotContact: true;
      clearProgramTrack: true;
    }
  | {
      ok: false;
      status: 409;
      code: "CANNOT_LIFT_SUPPRESSION";
      message: string;
    }
  | { ok: true; writeSuppression: false };

export function planDoNotContactChange(
  input: PlanDoNotContactChangeInput,
): PlanDoNotContactChangeResult {
  if (input.nextDoNotContact === input.currentlyDoNotContact) {
    return { ok: true, writeSuppression: false };
  }
  if (!input.nextDoNotContact) {
    return {
      ok: false,
      status: 409,
      code: "CANNOT_LIFT_SUPPRESSION",
      message: "Do not contact is permanent",
    };
  }
  return {
    ok: true,
    writeSuppression: true,
    reason: "do_not_contact",
    setDoNotContact: true,
    clearProgramTrack: true,
  };
}

export function blocksPersonCreate(reason: SuppressionReason | null): boolean {
  return reason !== null;
}

export function blocksImportUpdate(reason: SuppressionReason | null): boolean {
  if (!reason) {
    return false;
  }
  const policy = SUPPRESSION_POLICIES[reason];
  return policy.purgePerson || reason === "do_not_contact";
}

export type SalesCampaignEligibilityInput = {
  suppressionReason: SuppressionReason | null;
  stayInTouch: boolean;
  doNotContact: boolean;
};

export function isEligibleForSalesCampaign(
  input: SalesCampaignEligibilityInput,
): boolean {
  if (input.doNotContact) {
    return false;
  }
  if (input.stayInTouch) {
    return false;
  }
  if (!input.suppressionReason) {
    return true;
  }
  return !SUPPRESSION_POLICIES[input.suppressionReason].blockSalesCampaigns;
}

export type NewsletterEligibilityInput = {
  suppressionReason: SuppressionReason | null;
  newsletterGranted: boolean;
};

export function isEligibleForNewsletter(
  input: NewsletterEligibilityInput,
): boolean {
  if (!input.newsletterGranted) {
    return false;
  }
  if (!input.suppressionReason) {
    return true;
  }
  return !SUPPRESSION_POLICIES[input.suppressionReason].blockNewsletter;
}

export function suppressionLookupEmail(email: string): string {
  return canonicalEmail(email);
}

export const suppressedCreateError = {
  status: 409 as const,
  code: "SUPPRESSED",
  message: "This email is suppressed",
};
