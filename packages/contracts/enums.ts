import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "member"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const personSourceSchema = z.enum([
  "linkedin",
  "workable",
  "referral",
  "other",
  "website",
]);
export type PersonSource = z.infer<typeof personSourceSchema>;

export const programTrackSchema = z.enum([
  "allocation",
  "incubator",
  "recruitment",
  "capital_raising",
]);
export type ProgramTrack = z.infer<typeof programTrackSchema>;

export const programInterestSchema = z.enum([
  "hedge_fund_incubator",
  "lp_raising_program",
  "quant_analyst_placement",
  "not_sure",
]);
export type ProgramInterest = z.infer<typeof programInterestSchema>;

export const leadTempSchema = z.enum(["cold", "lukewarm", "warm", "hot"]);
export type LeadTemp = z.infer<typeof leadTempSchema>;

export const operatorWarmthLevelSchema = z.enum([
  "skeptical",
  "watch",
  "pursue",
  "priority",
]);
export type OperatorWarmthLevel = z.infer<typeof operatorWarmthLevelSchema>;

export const OPERATOR_WARMTH_LABELS: Record<OperatorWarmthLevel, string> = {
  skeptical: "Skeptical",
  watch: "Watch",
  pursue: "Pursue",
  priority: "Priority",
};

export const LEAD_TEMP_TO_OPERATOR_WARMTH: Record<
  LeadTemp,
  OperatorWarmthLevel
> = {
  cold: "skeptical",
  lukewarm: "watch",
  warm: "pursue",
  hot: "priority",
};

export const budgetQualifiedSchema = z.enum([
  "light",
  "heavy",
  "not_qualified",
  "unknown",
]);
export type BudgetQualified = z.infer<typeof budgetQualifiedSchema>;

export const allocationStageSchema = z.enum([
  "applied",
  "contacted",
  "in_conversation",
  "decision",
  "allocated",
  "nurture",
  "passed",
]);
export type AllocationStage = z.infer<typeof allocationStageSchema>;

export const allocationDecisionSchema = z.enum([
  "allocate",
  "route_incubator",
  "pass",
]);
export type AllocationDecision = z.infer<typeof allocationDecisionSchema>;

export const incubatorStageSchema = z.enum([
  "sent",
  "applied",
  "approved",
  "rejected",
]);
export type IncubatorStage = z.infer<typeof incubatorStageSchema>;

export const incubatorTierSchema = z.enum([
  "tier_1",
  "tier_2",
  "tier_3",
  "tier_4",
]);
export type IncubatorTierName = z.infer<typeof incubatorTierSchema>;

export const taskKindSchema = z.enum(["email", "call", "meeting", "dnc"]);
export type TaskKind = z.infer<typeof taskKindSchema>;

export const taskStatusSchema = z.enum(["open", "done", "rescheduled"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const meetingOutcomeSchema = z.enum([
  "scheduled",
  "held",
  "no_show",
  "rescheduled",
]);
export type MeetingOutcome = z.infer<typeof meetingOutcomeSchema>;

export const mailboxSchema = z.enum(["personal", "partner"]);
export type Mailbox = z.infer<typeof mailboxSchema>;

export const activityTypeSchema = z.enum([
  "note",
  "stage_change",
  "decision",
  "meeting",
  "email",
  "field_change",
  "import",
  "webhook",
]);
export type ActivityType = z.infer<typeof activityTypeSchema>;

export const suppressionReasonSchema = z.enum([
  "unsubscribed",
  "complained",
  "hard_bounced",
  "do_not_contact",
  "rejected",
  "enrolled",
]);
export type SuppressionReason = z.infer<typeof suppressionReasonSchema>;

export const suppressionSourceSchema = z.enum([
  "operator",
  "gmail",
  "website_form",
  "import",
  "bounce",
  "stripe",
  "postmark",
  "one_click",
]);
export type SuppressionSource = z.infer<typeof suppressionSourceSchema>;

export const consentChannelSchema = z.enum([
  "inquiry",
  "newsletter",
  "stay_in_touch",
]);
export type ConsentChannel = z.infer<typeof consentChannelSchema>;

export const consentStatusSchema = z.enum(["granted", "withdrawn"]);
export type ConsentStatus = z.infer<typeof consentStatusSchema>;

export const consentSourceSchema = z.enum([
  "website_form",
  "operator",
  "import",
  "email_link",
]);
export type ConsentSource = z.infer<typeof consentSourceSchema>;

export const personSignalKindSchema = z.enum([
  "aum_or_budget",
  "warmth",
  "decision_timeline",
  "program_fit",
  "objection",
  "other",
]);
export type PersonSignalKind = z.infer<typeof personSignalKindSchema>;

export const personSignalSourceSchema = z.enum([
  "email_message",
  "task",
  "meeting",
  "activity_note",
  "website_lead",
  "import",
  "operator",
]);
export type PersonSignalSource = z.infer<typeof personSignalSourceSchema>;

export const isoDateSchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime();
export const uuidSchema = z.uuid();
export const emailSchema = z.email();
export const emailInputSchema = z.email().transform((value) => value.toLowerCase());
