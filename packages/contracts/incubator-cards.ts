import { z } from "zod";
import {
  budgetQualifiedSchema,
  incubatorStageSchema,
  incubatorTierSchema,
  isoDateTimeSchema,
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
  tier: incubatorTierSchema.optional(),
  priceUsd: z.number().int().optional(),
  closeReason: z.string().optional(),
  confirmPaid: z.boolean().optional(),
});
export type IncubatorStageMoveBody = z.infer<
  typeof incubatorStageMoveBodySchema
>;

export const incubatorBoardPersonSchema = z.object({
  id: uuidSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  budgetQualified: budgetQualifiedSchema,
});
export type IncubatorBoardPerson = z.infer<typeof incubatorBoardPersonSchema>;

export const incubatorBoardCardSchema = z.object({
  card: incubatorCardSchema,
  person: incubatorBoardPersonSchema,
  noCallAppLink: z.boolean(),
  daysInStage: z.number().int().nonnegative(),
});
export type IncubatorBoardCard = z.infer<typeof incubatorBoardCardSchema>;

export const incubatorColumnStatsSchema = z.object({
  count: z.number().int().nonnegative(),
  priceUsd: z.number().nonnegative(),
});

export const incubatorBoardResponseSchema = z.object({
  columns: z.object({
    routed: z.array(incubatorBoardCardSchema),
    application_sent: z.array(incubatorBoardCardSchema),
    application_received: z.array(incubatorBoardCardSchema),
    offer_made: z.array(incubatorBoardCardSchema),
    paid: z.array(incubatorBoardCardSchema),
    enrolled: z.array(incubatorBoardCardSchema),
  }),
  closed: z.array(incubatorBoardCardSchema),
  totals: z.object({
    pipelineUsd: z.number().nonnegative(),
    weightedUsd: z.number().nonnegative(),
    columns: z.object({
      routed: incubatorColumnStatsSchema,
      application_sent: incubatorColumnStatsSchema,
      application_received: incubatorColumnStatsSchema,
      offer_made: incubatorColumnStatsSchema,
      paid: incubatorColumnStatsSchema,
      enrolled: incubatorColumnStatsSchema,
    }),
  }),
});
export type IncubatorBoardResponse = z.infer<
  typeof incubatorBoardResponseSchema
>;
