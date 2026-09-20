import { z } from "zod";
import {
  campaignIntensitySchema,
  campaignLaneSchema,
  campaignProgramTokenSchema,
  campaignSendPurposeSchema,
  type CampaignIntensity,
  type CampaignLane,
  type CampaignProgramToken,
  type CampaignSequenceAction,
} from "./campaign";
import { canonicalEmail } from "./email-matching";
import { isoDateTimeSchema, uuidSchema } from "./enums";
import { PARTNER_MAILBOX_EMAIL } from "./mailboxes";
import { MS_PER_DAY } from "./scoring";
import { isCampaignFromAddress, sendTickBudget } from "./send";

export const MAIL_ENGINE_MAX_TOUCHES = 2;

/** Days until the single bump. null means touch 0 only. */
export const MAIL_BUMP_DELAY_DAYS: Record<CampaignIntensity, number | null> = {
  none: null,
  soft: null,
  cold: null,
  lukewarm: 5,
  warm: 3,
  hot: 2,
};

export const mailEnrollmentStatusSchema = z.enum([
  "scheduled",
  "queued",
  "canceled",
  "skipped",
]);
export type MailEnrollmentStatus = z.infer<typeof mailEnrollmentStatusSchema>;

export const mailEngineActionSchema = z.enum(["enroll", "cancel", "noop"]);
export type MailEngineAction = z.infer<typeof mailEngineActionSchema>;

export function planMailEngineAction(
  sequenceAction: CampaignSequenceAction | null,
): MailEngineAction {
  if (sequenceAction === "start") {
    return "enroll";
  }
  if (sequenceAction === "stop") {
    return "cancel";
  }
  return "noop";
}

export function mailBumpDelayDays(intensity: CampaignIntensity): number | null {
  return MAIL_BUMP_DELAY_DAYS[intensity];
}

export type PlannedMailTouch = {
  touchIndex: 0 | 1;
  dueAt: number;
};

export function planEnrollmentTouches(input: {
  enrolledAt: number;
  intensity: CampaignIntensity;
  lane: CampaignLane;
}): PlannedMailTouch[] {
  const touches: PlannedMailTouch[] = [
    { touchIndex: 0, dueAt: input.enrolledAt },
  ];
  if (input.lane !== "sales") {
    return touches;
  }
  const days = mailBumpDelayDays(input.intensity);
  if (days === null) {
    return touches;
  }
  return [
    ...touches,
    {
      touchIndex: 1,
      dueAt: input.enrolledAt + days * MS_PER_DAY,
    },
  ];
}

export function planCampaignReplyTo(
  ownerEmail: string | null | undefined,
): string {
  const raw = ownerEmail?.trim() ?? "";
  if (!raw.includes("@")) {
    return PARTNER_MAILBOX_EMAIL;
  }
  const email = canonicalEmail(raw);
  if (isCampaignFromAddress(email)) {
    return PARTNER_MAILBOX_EMAIL;
  }
  return email;
}

export function planMailReplyCancel(input: {
  enrolledAt: number;
  replyAt: number;
}): boolean {
  return input.replyAt >= input.enrolledAt;
}

export function isBlankMailTemplate(subject: string, bodyText: string): boolean {
  return subject.trim().length === 0 || bodyText.trim().length === 0;
}

const MAIL_MERGE_TOKEN = /\{\{(name|firstName|program|stage)\}\}/g;

export type MailMergeFields = {
  name: string;
  firstName: string;
  program: string;
  stage: string;
};

export function mergeMailTemplate(
  template: string,
  fields: MailMergeFields,
): string {
  return template.replace(MAIL_MERGE_TOKEN, (_match, key: string) => {
    if (key === "name") {
      return fields.name;
    }
    if (key === "firstName") {
      return fields.firstName;
    }
    if (key === "program") {
      return fields.program;
    }
    return fields.stage;
  });
}

export function planMailTickEnqueueCount(input: {
  dueCount: number;
  alreadyQueued: number;
  dailyCap: number;
  alreadySentToday: number;
  remainingTicksInWindow: number;
}): number {
  if (input.dueCount <= 0 || input.remainingTicksInWindow <= 0) {
    return 0;
  }
  const budget = sendTickBudget({
    dailyCap: input.dailyCap,
    alreadySentToday: input.alreadySentToday,
    queued: input.alreadyQueued + input.dueCount,
    remainingTicksInWindow: input.remainingTicksInWindow,
  });
  return Math.max(0, Math.min(input.dueCount, budget - input.alreadyQueued));
}

export type MailTemplateCatalogEntry = {
  lane: CampaignLane;
  program: CampaignProgramToken;
  stage: string;
  purpose: "sales" | "newsletter";
  label: string;
};

const SALES_ALLOCATION_STAGES = [
  "applied",
  "contacted",
  "in_conversation",
  "decision",
  "nurture",
] as const;

const SALES_INCUBATOR_STAGES = ["sent", "applied"] as const;

function salesEntry(
  program: CampaignProgramToken,
  stage: string,
  label: string,
): MailTemplateCatalogEntry {
  return {
    lane: "sales",
    program,
    stage,
    purpose: "sales",
    label,
  };
}

export const MAIL_TEMPLATE_CATALOG: readonly MailTemplateCatalogEntry[] = [
  ...SALES_ALLOCATION_STAGES.map((stage) =>
    salesEntry("allocation", stage, `Allocation · ${stage}`),
  ),
  ...SALES_INCUBATOR_STAGES.map((stage) =>
    salesEntry("incubator", stage, `Incubator · ${stage}`),
  ),
  salesEntry("recruitment", "none", "Recruitment"),
  salesEntry("capital_raising", "none", "Capital raising"),
  salesEntry("unknown", "none", "Unknown track"),
  {
    lane: "newsletter",
    program: "none",
    stage: "none",
    purpose: "newsletter",
    label: "Closed-pipeline stay-in-touch",
  },
];

export function mailTemplateKey(input: {
  lane: CampaignLane;
  program: CampaignProgramToken;
  stage: string;
}): string {
  return `${input.lane}.${input.program}.${input.stage}`;
}

export const mailTemplateSchema = z.object({
  id: uuidSchema,
  lane: campaignLaneSchema,
  program: campaignProgramTokenSchema,
  stage: z.string().min(1),
  purpose: campaignSendPurposeSchema,
  subject: z.string(),
  bodyText: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MailTemplate = z.infer<typeof mailTemplateSchema>;

export const mailTemplateListResponseSchema = z.object({
  data: z.array(mailTemplateSchema),
  catalog: z.array(
    z.object({
      lane: campaignLaneSchema,
      program: campaignProgramTokenSchema,
      stage: z.string().min(1),
      purpose: campaignSendPurposeSchema,
      label: z.string().min(1),
    }),
  ),
});
export type MailTemplateListResponse = z.infer<
  typeof mailTemplateListResponseSchema
>;

export const mailTemplateUpsertBodySchema = z.object({
  lane: campaignLaneSchema,
  program: campaignProgramTokenSchema,
  stage: z.string().trim().min(1),
  purpose: campaignSendPurposeSchema,
  subject: z.string(),
  bodyText: z.string(),
});
export type MailTemplateUpsertBody = z.infer<typeof mailTemplateUpsertBodySchema>;

export const personMailEnrollmentSummarySchema = z.object({
  tag: z.string().min(1),
  touchIndex: z.number().int().min(0).max(1),
  status: mailEnrollmentStatusSchema,
  dueAt: isoDateTimeSchema,
});
export type PersonMailEnrollmentSummary = z.infer<
  typeof personMailEnrollmentSummarySchema
>;
