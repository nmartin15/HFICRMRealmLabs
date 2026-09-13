import { z } from "zod";
import {
  consentChannelSchema,
  consentSourceSchema,
  consentStatusSchema,
  isoDateTimeSchema,
  uuidSchema,
  type ConsentChannel,
  type ConsentSource,
} from "./enums";

export const personConsentSchema = z.object({
  id: uuidSchema,
  personId: uuidSchema,
  channel: consentChannelSchema,
  status: consentStatusSchema,
  source: consentSourceSchema,
  grantedAt: isoDateTimeSchema.nullable(),
  withdrawnAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PersonConsent = z.infer<typeof personConsentSchema>;

export const personConsentEventSchema = z.object({
  id: uuidSchema,
  personId: uuidSchema.nullable(),
  emailHash: z.string().min(1),
  channel: consentChannelSchema,
  status: consentStatusSchema,
  source: consentSourceSchema,
  occurredAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PersonConsentEvent = z.infer<typeof personConsentEventSchema>;

export type ConsentGrantInput = {
  channel: ConsentChannel;
  source: ConsentSource;
};

export type ConsentGrantPlan = {
  channel: ConsentChannel;
  status: "granted";
  source: ConsentSource;
  writeEvent: true;
};

export function planConsentGrant(input: ConsentGrantInput): ConsentGrantPlan {
  return {
    channel: input.channel,
    status: "granted",
    source: input.source,
    writeEvent: true,
  };
}

export type NewsletterWithdrawPlan = {
  suppress: false;
  purgePerson: false;
  withdrawChannel: "newsletter";
  status: "withdrawn";
};

export function planNewsletterWithdraw(): NewsletterWithdrawPlan {
  return {
    suppress: false,
    purgePerson: false,
    withdrawChannel: "newsletter",
    status: "withdrawn",
  };
}

export type FullOptOutPlan = {
  suppress: true;
  reason: "unsubscribed";
  purgePerson: true;
  withdrawAll: true;
};

export function planFullOptOut(): FullOptOutPlan {
  return {
    suppress: true,
    reason: "unsubscribed",
    purgePerson: true,
    withdrawAll: true,
  };
}

export function hasStayInTouch(
  consents: readonly { channel: ConsentChannel; status: "granted" | "withdrawn" }[],
): boolean {
  return consents.some(
    (row) => row.channel === "stay_in_touch" && row.status === "granted",
  );
}

export function hasNewsletterGrant(
  consents: readonly { channel: ConsentChannel; status: "granted" | "withdrawn" }[],
): boolean {
  return consents.some(
    (row) => row.channel === "newsletter" && row.status === "granted",
  );
}
