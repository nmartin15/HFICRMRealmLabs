import { z } from "zod";
import { isoDateSchema, isoDateTimeSchema, uuidSchema } from "./enums";

export const reportInputSchema = z.object({
  id: uuidSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  linkedinImpressions: z.number().int().nonnegative(),
  jobPostApplies: z.number().int().nonnegative(),
  createdBy: uuidSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ReportInput = z.infer<typeof reportInputSchema>;

export const reportInputInsertSchema = reportInputSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ReportInputInsert = z.infer<typeof reportInputInsertSchema>;

export const reportInputCreateBodySchema = reportInputSchema.omit({
  id: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});
export type ReportInputCreateBody = z.infer<typeof reportInputCreateBodySchema>;

export const reportInputUpdateBodySchema = reportInputCreateBodySchema.partial();
export type ReportInputUpdateBody = z.infer<typeof reportInputUpdateBodySchema>;

export const reportInputListResponseSchema = z.object({
  data: z.array(reportInputSchema),
});
export type ReportInputListResponse = z.infer<
  typeof reportInputListResponseSchema
>;

export const reportInputIdParamsSchema = z.object({
  id: uuidSchema,
});
export type ReportInputIdParams = z.infer<typeof reportInputIdParamsSchema>;
