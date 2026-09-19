import { z } from "zod";
import { activityPayloadSchema, activitySchema } from "./activities";
import {
  CAPITAL_RAISING_BOARD_HREF,
  INCUBATOR_BOARD_HREF,
  RECRUITMENT_BOARD_HREF,
  ALLOCATION_BOARD_HREF,
} from "./allocation";
import {
  allocationStageSchema,
  budgetQualifiedSchema,
  contactKindSchema,
  emailInputSchema,
  emailSchema,
  incubatorStageSchema,
  isoDateSchema,
  isoDateTimeSchema,
  leadTempSchema,
  operatorWarmthLevelSchema,
  personSourceSchema,
  programInterestSchema,
  programTrackSchema,
  recruiterSpecialtySchema,
  uuidSchema,
  type ContactKind,
  type PersonSource,
  type ProgramTrack,
  type RecruiterSpecialty,
} from "./enums";
import { splitName } from "./import";
import { personScoreSchema } from "./scoring";
import { createTaskBodySchema, taskSchema } from "./tasks";
import { timelineItemSchema } from "./timeline";

export const sourceRecruiterSchema = z.object({
  id: uuidSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  recruiterSpecialty: recruiterSpecialtySchema,
});
export type SourceRecruiter = z.infer<typeof sourceRecruiterSchema>;

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
  score: personScoreSchema.nullable(),
  doNotContact: z.boolean(),
  needsReview: z.boolean(),
  contactKind: contactKindSchema,
  recruiterSpecialty: recruiterSpecialtySchema.nullable(),
  sourceRecruiterId: uuidSchema.nullable(),
  sourceRecruiter: sourceRecruiterSchema.nullable(),
  ownerId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});
export type Person = z.infer<typeof personSchema>;

export const personListQuerySchema = z.object({
  contactKind: contactKindSchema.optional(),
});
export type PersonListQuery = z.infer<typeof personListQuerySchema>;

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
  contactKind: contactKindSchema.optional(),
  recruiterSpecialty: recruiterSpecialtySchema.nullable().optional(),
  source: personSourceSchema.optional(),
  sourceRecruiterId: uuidSchema.nullable().optional(),
});
export type PersonPatch = z.infer<typeof personPatchSchema>;

export const operatorTempBodySchema = z.object({
  level: operatorWarmthLevelSchema,
});
export type OperatorTempBody = z.infer<typeof operatorTempBodySchema>;

export const createPersonNoteBodySchema = z.object({
  text: z.string().trim().min(1),
});
export type CreatePersonNoteBody = z.infer<typeof createPersonNoteBodySchema>;

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
  suppressed?: boolean;
}): PlanManualContactResult {
  const names = splitName(input.name);
  if ("error" in names) {
    return failContact(400, "INVALID_NAME", names.error);
  }

  if (input.suppressed) {
    return failContact(409, "SUPPRESSED", "This email is suppressed");
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

export type PlanContactKindSuccess = {
  ok: true;
  contactKind: ContactKind;
  recruiterSpecialty: RecruiterSpecialty | null;
};

export type PlanContactKindResult =
  | PlanContactKindSuccess
  | PlanManualContactError;

export function planContactKindChange(input: {
  contactKind: ContactKind;
  recruiterSpecialty: RecruiterSpecialty | null | undefined;
  programTrack: ProgramTrack | null;
  hasBoardCard: boolean;
  source: PersonSource;
}): PlanContactKindResult {
  if (input.contactKind === "recruiter") {
    if (!input.recruiterSpecialty) {
      return failContact(
        400,
        "SPECIALTY_REQUIRED",
        "Recruiter specialty is required",
      );
    }
    if (input.programTrack) {
      return failContact(
        409,
        "RECRUITER_HAS_TRACK",
        "Recruiters cannot have a program track",
      );
    }
    if (input.hasBoardCard) {
      return failContact(
        409,
        "RECRUITER_ON_BOARD",
        "Recruiters cannot be on a pipeline board",
      );
    }
    if (input.source === "recruiter") {
      return failContact(
        400,
        "RECRUITER_NESTED_SOURCE",
        "A recruiter cannot be sourced from another recruiter",
      );
    }
    return {
      ok: true,
      contactKind: "recruiter",
      recruiterSpecialty: input.recruiterSpecialty,
    };
  }
  if (input.recruiterSpecialty) {
    return failContact(
      400,
      "SPECIALTY_CONTACT_ONLY",
      "Specialty is only for recruiter contacts",
    );
  }
  return { ok: true, contactKind: "contact", recruiterSpecialty: null };
}

export type SourceRecruiterTarget = {
  id: string;
  contactKind: ContactKind;
  deleted: boolean;
};

export type PlanRecruiterSourceSuccess = {
  ok: true;
  source: PersonSource;
  sourceRecruiterId: string | null;
};

export type PlanRecruiterSourceResult =
  | PlanRecruiterSourceSuccess
  | PlanManualContactError;

export function planRecruiterSource(input: {
  source: PersonSource;
  sourceRecruiterId: string | null | undefined;
  personId: string | null;
  target?: SourceRecruiterTarget | null;
}): PlanRecruiterSourceResult {
  if (input.source === "recruiter") {
    if (!input.sourceRecruiterId) {
      return failContact(
        400,
        "RECRUITER_REQUIRED",
        "Recruiter source requires a recruiter contact",
      );
    }
    if (input.personId && input.sourceRecruiterId === input.personId) {
      return failContact(
        400,
        "RECRUITER_SELF",
        "A contact cannot be sourced from itself",
      );
    }
    if (input.target === undefined) {
      return {
        ok: true,
        source: "recruiter",
        sourceRecruiterId: input.sourceRecruiterId,
      };
    }
    if (!input.target || input.target.deleted) {
      return failContact(
        400,
        "RECRUITER_NOT_FOUND",
        "Recruiter contact not found",
      );
    }
    if (input.target.contactKind !== "recruiter") {
      return failContact(
        400,
        "NOT_A_RECRUITER",
        "Source must be a recruiter contact",
      );
    }
    return {
      ok: true,
      source: "recruiter",
      sourceRecruiterId: input.sourceRecruiterId,
    };
  }
  if (input.sourceRecruiterId) {
    return failContact(
      400,
      "RECRUITER_SOURCE_ONLY",
      "Recruiter can only be set when source is recruiter",
    );
  }
  return { ok: true, source: input.source, sourceRecruiterId: null };
}

export const createPersonBodySchema = z
  .object({
    name: z.string().trim().min(1),
    email: emailInputSchema,
    title: z.string().trim().min(1).optional(),
    company: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).optional(),
    source: personSourceSchema.default("other"),
    notes: z.string().trim().min(1).optional(),
    firstTask: createTaskBodySchema.optional(),
    contactKind: contactKindSchema.default("contact"),
    recruiterSpecialty: recruiterSpecialtySchema.optional(),
    sourceRecruiterId: uuidSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const kind = planContactKindChange({
      contactKind: data.contactKind,
      recruiterSpecialty: data.recruiterSpecialty,
      programTrack: null,
      hasBoardCard: false,
      source: data.source,
    });
    if (!kind.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["contactKind"],
        message: kind.message,
      });
      return;
    }
    const source = planRecruiterSource({
      source: data.source,
      sourceRecruiterId: data.sourceRecruiterId,
      personId: null,
    });
    if (!source.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceRecruiterId"],
        message: source.message,
      });
    }
  });
export type CreatePersonBody = z.infer<typeof createPersonBodySchema>;

export const createPersonResponseSchema = z.object({
  personId: uuidSchema,
  reusedPerson: z.boolean(),
});
export type CreatePersonResponse = z.infer<typeof createPersonResponseSchema>;

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

export const personCampaignHoldSchema = z.object({
  tag: z.string().min(1),
  sequenceAction: z.literal("pending_review"),
});
export type PersonCampaignHold = z.infer<typeof personCampaignHoldSchema>;

export const personDetailResponseSchema = z.object({
  person: personSchema,
  board: personBoardBadgeSchema.nullable(),
  tasks: z.array(taskSchema),
  timeline: z.array(timelineItemSchema),
  taskGuidePayloads: z.array(activityPayloadSchema),
  scoreHoldSummary: z.string().nullable(),
  campaignHold: personCampaignHoldSchema.nullable(),
});
export type PersonDetailResponse = z.infer<typeof personDetailResponseSchema>;

export const personNoteResponseSchema = activitySchema;
export type PersonNoteResponse = z.infer<typeof personNoteResponseSchema>;
