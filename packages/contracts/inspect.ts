import { z } from "zod";
import {
  consentChannelSchema,
  consentSourceSchema,
  consentStatusSchema,
  isoDateTimeSchema,
  leadTempSchema,
  operatorWarmthLevelSchema,
  personSignalKindSchema,
  personSignalSourceSchema,
  suppressionReasonSchema,
  suppressionSourceSchema,
  uuidSchema,
} from "./enums";
import { emailHashSchema } from "./suppression";
import {
  personScoreSnapshotSchema,
  scoreComponentSchema,
  scoreFormulaConfigSchema,
} from "./scoring";

export const scoreActorSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  name: z.string().min(1),
});
export type ScoreActor = z.infer<typeof scoreActorSchema>;

export const inspectScoreViewSchema = z.object({
  score: z.number().int(),
  campaignBucket: leadTempSchema,
  displayBucket: leadTempSchema,
  explanation: z.string().nullable(),
});
export type InspectScoreViewDto = z.infer<typeof inspectScoreViewSchema>;

export const inspectConsentRowSchema = z.object({
  channel: consentChannelSchema,
  status: consentStatusSchema,
  source: consentSourceSchema,
  grantedAt: isoDateTimeSchema.nullable(),
  withdrawnAt: isoDateTimeSchema.nullable(),
});
export type InspectConsentRow = z.infer<typeof inspectConsentRowSchema>;

export const inspectSuppressionRowSchema = z.object({
  reason: suppressionReasonSchema,
  source: suppressionSourceSchema,
  occurredAt: isoDateTimeSchema,
  purgedAt: isoDateTimeSchema.nullable(),
});
export type InspectSuppressionRow = z.infer<typeof inspectSuppressionRowSchema>;

export const inspectOperatorLineSchema = z.object({
  active: z.boolean(),
  level: operatorWarmthLevelSchema.nullable(),
  setAt: isoDateTimeSchema.nullable(),
  setBy: scoreActorSchema.nullable(),
  contribution: z.number().int(),
  raw: z.number().int(),
  daysOld: z.number().int().nonnegative().nullable(),
  daysUntilExpiry: z.number().int().nonnegative().nullable(),
});
export type InspectOperatorLine = z.infer<typeof inspectOperatorLineSchema>;

export const inspectSignalRowSchema = z.object({
  id: uuidSchema,
  kind: personSignalKindSchema,
  sourceType: personSignalSourceSchema,
  extractor: z.string().min(1),
  excerpt: z.string().nullable(),
  value: z.record(z.string(), z.unknown()),
  createdAt: isoDateTimeSchema,
  invalidatedAt: isoDateTimeSchema.nullable(),
});
export type InspectSignalRow = z.infer<typeof inspectSignalRowSchema>;

export const personInspectResponseSchema = z.object({
  score: inspectScoreViewSchema.nullable(),
  components: z.array(scoreComponentSchema),
  operator: inspectOperatorLineSchema,
  consents: z.array(inspectConsentRowSchema),
  suppression: inspectSuppressionRowSchema.nullable(),
  signals: z.array(inspectSignalRowSchema),
  snapshot: personScoreSnapshotSchema.nullable(),
});
export type PersonInspectResponse = z.infer<typeof personInspectResponseSchema>;

export const overrideRollupResponseSchema = z.object({
  activeCount: z.number().int().nonnegative(),
  averageAgeDays: z.number().int().nonnegative(),
  againstComputedCount: z.number().int().nonnegative(),
  againstComputedRate: z.number().nonnegative(),
});
export type OverrideRollupResponse = z.infer<typeof overrideRollupResponseSchema>;

export const scoreBucketCountsSchema = z.object({
  cold: z.number().int().nonnegative(),
  lukewarm: z.number().int().nonnegative(),
  warm: z.number().int().nonnegative(),
  hot: z.number().int().nonnegative(),
});

export const scoreConfigResponseSchema = z.object({
  version: z.string().min(1),
  config: scoreFormulaConfigSchema,
  createdAt: isoDateTimeSchema,
  createdBy: scoreActorSchema.nullable(),
});
export type ScoreConfigResponse = z.infer<typeof scoreConfigResponseSchema>;

export const scoreConfigPreviewResponseSchema = z.object({
  version: z.string().min(1),
  total: z.number().int().nonnegative(),
  campaignChanges: z.number().int().nonnegative(),
  before: scoreBucketCountsSchema,
  after: scoreBucketCountsSchema,
});
export type ScoreConfigPreviewResponse = z.infer<
  typeof scoreConfigPreviewResponseSchema
>;

export const scoreConfigSaveBodySchema = z.object({
  config: scoreFormulaConfigSchema.omit({ version: true }),
});
export type ScoreConfigSaveBody = z.infer<typeof scoreConfigSaveBodySchema>;

export const suppressionAuditRowSchema = z.object({
  id: uuidSchema,
  email: z.string().nullable(),
  emailHash: emailHashSchema,
  reason: suppressionReasonSchema,
  source: suppressionSourceSchema,
  occurredAt: isoDateTimeSchema,
  purgedAt: isoDateTimeSchema.nullable(),
  trigger: z.string().nullable(),
});
export type SuppressionAuditRow = z.infer<typeof suppressionAuditRowSchema>;

export const suppressionAuditListResponseSchema = z.object({
  data: z.array(suppressionAuditRowSchema),
});
export type SuppressionAuditListResponse = z.infer<
  typeof suppressionAuditListResponseSchema
>;

export const okInvalidateResponseSchema = z.object({
  ok: z.literal(true),
});

export const personSignalParamsSchema = z.object({
  id: uuidSchema,
  signalId: uuidSchema,
});
