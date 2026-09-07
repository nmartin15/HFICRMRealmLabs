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
  emailInputSchema,
  emailSchema,
  incubatorStageSchema,
  isoDateSchema,
  isoDateTimeSchema,
  leadTempSchema,
  personSourceSchema,
  programInterestSchema,
  programTrackSchema,
  uuidSchema,
} from "./enums";
import { splitName } from "./import";
import { createTaskBodySchema, taskSchema } from "./tasks";
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
  programInterest: programInterestSchema.nullable(),
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

export const createPersonBodySchema = z.object({
  name: z.string().trim().min(1),
  email: emailInputSchema,
  title: z.string().trim().min(1).optional(),
  company: z.string().trim().min(1).optional(),
  location: z.string().trim().min(1).optional(),
  source: personSourceSchema.default("other"),
  notes: z.string().trim().min(1).optional(),
  firstTask: createTaskBodySchema.optional(),
});
export type CreatePersonBody = z.infer<typeof createPersonBodySchema>;

export const createPersonResponseSchema = z.object({
  personId: uuidSchema,
  reusedPerson: z.boolean(),
});
export type CreatePersonResponse = z.infer<typeof createPersonResponseSchema>;

export type PlanManualContactExisting = {
  id: string;
  doNotContact: boolean;
  deleted: boolean;
};

export type PlanManualContactError = {
  ok: false;
  status: 400 | 409;
  code: string;
  message: string;
};

export type PlanManualContactSuccess = {
  ok: true;
  firstName: string;
  lastName: string;
  reusePersonId: string | null;
  restoreDeleted: boolean;
};

export type PlanManualContactResult =
  | PlanManualContactSuccess
  | PlanManualContactError;

function failContact(
  status: 400 | 409,
  code: string,
  message: string,
): PlanManualContactError {
  return { ok: false, status, code, message };
}

export function planManualContact(input: {
  name: string;
  existing: PlanManualContactExisting | null;
}): PlanManualContactResult {
  const names = splitName(input.name);
  if ("error" in names) {
    return failContact(400, "INVALID_NAME", names.error);
  }

  if (input.existing?.doNotContact) {
    return failContact(
      409,
      "DO_NOT_CONTACT",
      "Person is marked do not contact",
    );
  }

  if (input.existing && !input.existing.deleted) {
    return failContact(
      409,
      "EMAIL_EXISTS",
      "A contact with this email already exists",
    );
  }

  return {
    ok: true,
    firstName: names.firstName,
    lastName: names.lastName,
    reusePersonId: input.existing?.id ?? null,
    restoreDeleted: Boolean(input.existing?.deleted),
  };
}

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
