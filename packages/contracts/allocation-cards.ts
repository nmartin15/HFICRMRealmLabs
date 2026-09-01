import { z } from "zod";
import {
  ALLOCATION_OPEN_STAGES,
} from "./allocation";
import {
  allocationDecisionSchema,
  allocationStageSchema,
  budgetQualifiedSchema,
  isoDateSchema,
  isoDateTimeSchema,
  leadTempSchema,
  programTrackSchema,
  taskKindSchema,
  uuidSchema,
} from "./enums";

export const allocationCardSchema = z.object({
  id: uuidSchema,
  personId: uuidSchema,
  stage: allocationStageSchema,
  decision: allocationDecisionSchema.nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  decidedBy: uuidSchema.nullable(),
  passReason: z.string().nullable(),
  nurtureFollowUpAt: isoDateSchema.nullable(),
  noCallAppLink: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AllocationCard = z.infer<typeof allocationCardSchema>;

export const allocationCardInsertSchema = allocationCardSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    noCallAppLink: z.boolean().default(false),
  });
export type AllocationCardInsert = z.infer<typeof allocationCardInsertSchema>;

export const allocationCardIdParamsSchema = z.object({
  id: uuidSchema,
});
export type AllocationCardIdParams = z.infer<
  typeof allocationCardIdParamsSchema
>;

export const allocationOpenStageSchema = z.enum(ALLOCATION_OPEN_STAGES);
export type AllocationOpenStageValue = z.infer<
  typeof allocationOpenStageSchema
>;

export const allocationStageMoveBodySchema = z.object({
  stage: allocationOpenStageSchema,
});
export type AllocationStageMoveBody = z.infer<
  typeof allocationStageMoveBodySchema
>;

export const allocationBoardPersonSchema = z.object({
  id: uuidSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  company: z.string().nullable(),
  leadTemp: leadTempSchema.nullable(),
  budgetQualified: budgetQualifiedSchema,
  programTrack: programTrackSchema.nullable(),
});
export type AllocationBoardPerson = z.infer<typeof allocationBoardPersonSchema>;

export const allocationBoardCardSchema = z.object({
  card: allocationCardSchema,
  person: allocationBoardPersonSchema,
  daysInStage: z.number().int().nonnegative(),
  nextTaskAt: isoDateTimeSchema.nullable(),
  nextTaskKind: taskKindSchema.nullable(),
});
export type AllocationBoardCard = z.infer<typeof allocationBoardCardSchema>;

export const allocationBoardResponseSchema = z.object({
  columns: z.object({
    applied: z.array(allocationBoardCardSchema),
    contacted: z.array(allocationBoardCardSchema),
    in_conversation: z.array(allocationBoardCardSchema),
    decision: z.array(allocationBoardCardSchema),
  }),
  closed: z.array(allocationBoardCardSchema),
});
export type AllocationBoardResponse = z.infer<
  typeof allocationBoardResponseSchema
>;
