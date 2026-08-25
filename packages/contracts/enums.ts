import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "member"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const personSourceSchema = z.enum([
  "linkedin",
  "workable",
  "referral",
  "other",
]);
export type PersonSource = z.infer<typeof personSourceSchema>;

export const leadTempSchema = z.enum(["hot", "warm", "cold"]);
export type LeadTemp = z.infer<typeof leadTempSchema>;

export const budgetQualifiedSchema = z.enum(["yes", "no", "unknown"]);
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
  "routed",
  "application_sent",
  "application_received",
  "offer_made",
  "paid",
  "enrolled",
  "closed",
]);
export type IncubatorStage = z.infer<typeof incubatorStageSchema>;

export const incubatorTierSchema = z.enum([
  "tier_1",
  "tier_2",
  "tier_3",
  "tier_4",
]);
export type IncubatorTierName = z.infer<typeof incubatorTierSchema>;

export const meetingOutcomeSchema = z.enum([
  "scheduled",
  "held",
  "no_show",
  "rescheduled",
]);
export type MeetingOutcome = z.infer<typeof meetingOutcomeSchema>;

export const mailboxSchema = z.enum(["personal", "shared"]);
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

export const isoDateSchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime();
export const uuidSchema = z.uuid();
export const emailSchema = z.email();
export const emailInputSchema = z.email().transform((value) => value.toLowerCase());
