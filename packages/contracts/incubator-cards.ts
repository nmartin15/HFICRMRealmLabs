import { z } from "zod";
import {
  budgetQualifiedSchema,
  incubatorStageSchema,
  incubatorTierSchema,
  isoDateTimeSchema,
  programTrackSchema,
  uuidSchema,
} from "./enums";

export const incubatorCardSchema = z.object({
  id: uuidSchema,
  personId: uuidSchema,
  stage: incubatorStageSchema,
  tier: incubatorTierSchema.nullable(),
  priceUsd: z.number().int().nonnegative().nullable(),
  applicationRef: z.string().nullable(),
  applicationResult: z.string().nullable(),
  routingDetail: z.string().nullable(),
  routedAt: isoDateTimeSchema,
  closeReason: z.string().nullable(),
  closedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type IncubatorCard = z.infer<typeof incubatorCardSchema>;

export const incubatorCardInsertSchema = incubatorCardSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type IncubatorCardInsert = z.infer<typeof incubatorCardInsertSchema>;

export const incubatorCardIdParamsSchema = z.object({
  id: uuidSchema,
});
export type IncubatorCardIdParams = z.infer<
  typeof incubatorCardIdParamsSchema
>;

export const incubatorStageMoveBodySchema = z.object({
  stage: incubatorStageSchema,
  applicationRef: z.string().optional(),
  closeReason: z.string().optional(),
});
export type IncubatorStageMoveBody = z.infer<
  typeof incubatorStageMoveBodySchema
>;

export const incubatorBoardPersonSchema = z.object({
  id: uuidSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  budgetQualified: budgetQualifiedSchema,
  programTrack: programTrackSchema.nullable(),
});
export type IncubatorBoardPerson = z.infer<typeof incubatorBoardPersonSchema>;

export const incubatorBoardCardSchema = z.object({
  card: incubatorCardSchema,
  person: incubatorBoardPersonSchema,
  daysInStage: z.number().int().nonnegative(),
});
export type IncubatorBoardCard = z.infer<typeof incubatorBoardCardSchema>;

export const incubatorColumnStatsSchema = z.object({
  count: z.number().int().nonnegative(),
  priceUsd: z.number().nonnegative(),
});

export const incubatorBoardResponseSchema = z.object({
  columns: z.object({
    sent: z.array(incubatorBoardCardSchema),
    applied: z.array(incubatorBoardCardSchema),
    approved: z.array(incubatorBoardCardSchema),
  }),
  closed: z.array(incubatorBoardCardSchema),
  totals: z.object({
    pipelineUsd: z.number().nonnegative(),
    weightedUsd: z.number().nonnegative(),
    columns: z.object({
      sent: incubatorColumnStatsSchema,
      applied: incubatorColumnStatsSchema,
      approved: incubatorColumnStatsSchema,
    }),
  }),
});
export type IncubatorBoardResponse = z.infer<
  typeof incubatorBoardResponseSchema
>;
