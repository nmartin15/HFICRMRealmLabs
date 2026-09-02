import { z } from "zod";
import { activitySchema } from "./activities";
import {
  CAPITAL_RAISING_BOARD_HREF,
  INCUBATOR_BOARD_HREF,
  RECRUITMENT_BOARD_HREF,
  ALLOCATION_BOARD_HREF,
} from "./allocation";
import {
  allocationStageSchema,
  budgetQualifiedSchema,
  emailSchema,
  incubatorStageSchema,
  isoDateSchema,
  isoDateTimeSchema,
  leadTempSchema,
  personSourceSchema,
  programTrackSchema,
  uuidSchema,
} from "./enums";
import { taskSchema } from "./tasks";
import { timelineItemSchema } from "./timeline";

export const personSchema = z.object({
  id: uuidSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: emailSchema,
  title: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  source: personSourceSchema,
  resumeUrl: z.string().nullable(),
  resumeFilename: z.string().nullable(),
  resumeContentType: z.string().nullable(),
  appliedAt: isoDateSchema.nullable(),
  notes: z.string().nullable(),
  programTrack: programTrackSchema.nullable(),
  leadTemp: leadTempSchema.nullable(),
  budgetQualified: budgetQualifiedSchema,
  doNotContact: z.boolean(),
  needsReview: z.boolean(),
  ownerId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});
export type Person = z.infer<typeof personSchema>;

export const personInsertSchema = personSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  })
  .extend({
    budgetQualified: budgetQualifiedSchema.default("unknown"),
    doNotContact: z.boolean().default(false),
    needsReview: z.boolean().default(false),
  });
export type PersonInsert = z.infer<typeof personInsertSchema>;

export const personListResponseSchema = z.object({
  data: z.array(personSchema),
});
export type PersonListResponse = z.infer<typeof personListResponseSchema>;

export const personIdParamsSchema = z.object({
  id: uuidSchema,
});
export type PersonIdParams = z.infer<typeof personIdParamsSchema>;

export const personPatchSchema = z.object({
  programTrack: programTrackSchema.nullable().optional(),
  leadTemp: leadTempSchema.nullable().optional(),
  budgetQualified: budgetQualifiedSchema.optional(),
  doNotContact: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  resumeFilename: z.string().nullable().optional(),
  resumeContentType: z.string().nullable().optional(),
  ownerId: uuidSchema.nullable().optional(),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  needsReview: z.boolean().optional(),
});
export type PersonPatch = z.infer<typeof personPatchSchema>;

export const createPersonNoteBodySchema = z.object({
  text: z.string().trim().min(1),
});
export type CreatePersonNoteBody = z.infer<typeof createPersonNoteBodySchema>;

export const personBoardBadgeSchema = z.discriminatedUnion("board", [
  z.object({
    board: z.literal("allocation"),
    stage: allocationStageSchema,
    href: z.literal(ALLOCATION_BOARD_HREF),
  }),
  z.object({
    board: z.literal("recruitment"),
    stage: allocationStageSchema,
    href: z.literal(RECRUITMENT_BOARD_HREF),
  }),
  z.object({
    board: z.literal("capital_raising"),
    stage: allocationStageSchema,
    href: z.literal(CAPITAL_RAISING_BOARD_HREF),
  }),
  z.object({
    board: z.literal("incubator"),
    stage: incubatorStageSchema,
    href: z.literal(INCUBATOR_BOARD_HREF),
  }),
]);
export type PersonBoardBadgeResponse = z.infer<typeof personBoardBadgeSchema>;

export const personDetailResponseSchema = z.object({
  person: personSchema,
  board: personBoardBadgeSchema.nullable(),
  tasks: z.array(taskSchema),
  timeline: z.array(timelineItemSchema),
});
export type PersonDetailResponse = z.infer<typeof personDetailResponseSchema>;

export const personNoteResponseSchema = activitySchema;
export type PersonNoteResponse = z.infer<typeof personNoteResponseSchema>;
