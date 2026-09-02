import { z } from "zod";
import {
  emailInputSchema,
  isoDateSchema,
  personSourceSchema,
  programTrackSchema,
  uuidSchema,
  type IncubatorStage,
  type ProgramTrack,
} from "./enums";
import { splitName } from "./import";
import { createTaskBodySchema } from "./tasks";

export const createApplicantPersonBodySchema = z.object({
  name: z.string().trim().min(1),
  email: emailInputSchema,
  title: z.string().trim().min(1).optional(),
  company: z.string().trim().min(1).optional(),
  location: z.string().trim().min(1).optional(),
  source: personSourceSchema.default("other"),
  programTrack: programTrackSchema,
  appliedAt: isoDateSchema.optional(),
  firstTask: createTaskBodySchema,
});
export type CreateApplicantPersonBody = z.infer<
  typeof createApplicantPersonBodySchema
>;

export const createAllocationApplicantBodySchema =
  createApplicantPersonBodySchema;
export type CreateAllocationApplicantBody = z.infer<
  typeof createAllocationApplicantBodySchema
>;

export const createIncubatorApplicantBodySchema =
  createApplicantPersonBodySchema.extend({
    applicationRef: z.string().trim().min(1).optional(),
  });
export type CreateIncubatorApplicantBody = z.infer<
  typeof createIncubatorApplicantBodySchema
>;

export const createApplicantResponseSchema = z.object({
  personId: uuidSchema,
  cardId: uuidSchema.nullable(),
  reusedPerson: z.boolean(),
});
export type CreateApplicantResponse = z.infer<
  typeof createApplicantResponseSchema
>;

export type ApplicantPipeline = ProgramTrack;

export type PlanManualApplicantExisting = {
  id: string;
  doNotContact: boolean;
  deleted: boolean;
  hasAllocationCard: boolean;
  hasIncubatorCard: boolean;
};

export type PlanManualApplicantInput = {
  programTrack: ProgramTrack;
  name: string;
  existing: PlanManualApplicantExisting | null;
  applicationRef?: string;
};

export type PlanManualApplicantError = {
  ok: false;
  status: 400 | 409;
  code: string;
  message: string;
};

export type PlanManualApplicantSuccess = {
  ok: true;
  firstName: string;
  lastName: string;
  reusePersonId: string | null;
  restoreDeleted: boolean;
  allocationStage: "applied" | null;
  incubatorStage: Extract<IncubatorStage, "sent" | "applied"> | null;
  applicationRef: string | null;
  programTrack: ProgramTrack;
};

export type PlanManualApplicantResult =
  | PlanManualApplicantSuccess
  | PlanManualApplicantError;

function fail(
  status: 400 | 409,
  code: string,
  message: string,
): PlanManualApplicantError {
  return { ok: false, status, code, message };
}

export function planManualApplicant(
  input: PlanManualApplicantInput,
): PlanManualApplicantResult {
  const names = splitName(input.name);
  if ("error" in names) {
    return fail(400, "INVALID_NAME", names.error);
  }

  if (input.existing?.doNotContact) {
    return fail(
      409,
      "DO_NOT_CONTACT",
      "Person is marked do not contact",
    );
  }

  const base = {
    firstName: names.firstName,
    lastName: names.lastName,
    reusePersonId: input.existing?.id ?? null,
    restoreDeleted: Boolean(input.existing?.deleted),
    programTrack: input.programTrack,
  };

  if (
    input.programTrack === "allocation" ||
    input.programTrack === "recruitment" ||
    input.programTrack === "capital_raising"
  ) {
    if (input.existing?.hasAllocationCard) {
      return fail(
        409,
        "ALREADY_ON_ALLOCATION",
        "Person already has an allocation card",
      );
    }
    return {
      ok: true,
      ...base,
      allocationStage: "applied",
      incubatorStage: null,
      applicationRef: null,
    };
  }

  if (input.programTrack === "incubator") {
    if (input.existing?.hasIncubatorCard) {
      return fail(
        409,
        "ALREADY_ON_INCUBATOR",
        "Person already has an incubator card",
      );
    }
    const applicationRef = input.applicationRef?.trim()
      ? input.applicationRef.trim()
      : null;
    return {
      ok: true,
      ...base,
      allocationStage: null,
      incubatorStage: applicationRef ? "applied" : "sent",
      applicationRef,
    };
  }

  return {
    ok: true,
    ...base,
    allocationStage: null,
    incubatorStage: null,
    applicationRef: null,
  };
}

