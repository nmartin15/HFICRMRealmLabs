import { z } from "zod";
import {
  emailInputSchema,
  programInterestSchema,
  uuidSchema,
} from "./enums";
import { splitName } from "./import";

export const WEBSITE_INTAKE_ACTOR = {
  id: "website-intake",
  email: "website-intake@realmlabs.co",
} as const;

export const websiteLeadBodySchema = z
  .object({
    name: z.string().trim().min(1),
    email: emailInputSchema,
    linkedinUrl: z.string().trim().min(1).optional(),
    programInterest: programInterestSchema,
    yearsExperience: z.number().int().optional(),
    message: z.string().max(1000).optional(),
    company: z.string().optional(),
  })
  .strict();
export type WebsiteLeadBody = z.infer<typeof websiteLeadBodySchema>;

export const websiteLeadCreatedResponseSchema = z.object({
  status: z.literal("created"),
  id: uuidSchema,
});

export const websiteLeadUpdatedResponseSchema = z.object({
  status: z.literal("updated"),
});

export const websiteLeadResponseSchema = z.union([
  websiteLeadCreatedResponseSchema,
  websiteLeadUpdatedResponseSchema,
]);
export type WebsiteLeadResponse = z.infer<typeof websiteLeadResponseSchema>;

export function isWebsiteLeadHoneypot(body: WebsiteLeadBody): boolean {
  return Boolean(body.company && body.company.trim().length > 0);
}

export function formatWebsiteLeadNotes(input: {
  message?: string;
  linkedinUrl?: string;
  yearsExperience?: number;
}): string | null {
  const lines: string[] = [];
  if (input.message && input.message.trim().length > 0) {
    lines.push(input.message.trim());
  }
  if (input.linkedinUrl) {
    lines.push(`LinkedIn: ${input.linkedinUrl}`);
  }
  if (input.yearsExperience !== undefined) {
    lines.push(`Years of experience: ${input.yearsExperience}`);
  }
  if (lines.length === 0) {
    return null;
  }
  return lines.join("\n");
}

export function appendWebsiteLeadMessage(
  existingNotes: string | null,
  message: string | undefined,
): string | null {
  if (!message || message.trim().length === 0) {
    return existingNotes;
  }
  const trimmed = message.trim();
  if (!existingNotes || existingNotes.trim().length === 0) {
    return trimmed;
  }
  return `${existingNotes.trim()}\n\n${trimmed}`;
}

export type PlanWebsiteLeadExisting = {
  id: string;
  doNotContact: boolean;
  deleted: boolean;
  hasAllocationCard: boolean;
};

export type PlanWebsiteLeadResult =
  | {
      ok: true;
      action: "create";
      firstName: string;
      lastName: string;
      notes: string | null;
    }
  | {
      ok: true;
      action: "update";
      personId: string;
      notes: string | null;
      ensureAllocationCard: boolean;
      setProgramTrackAllocation: boolean;
    }
  | { ok: false; status: 400; code: string; message: string };

export function planWebsiteLead(input: {
  name: string;
  message?: string;
  linkedinUrl?: string;
  yearsExperience?: number;
  existing: PlanWebsiteLeadExisting | null;
  existingNotes: string | null;
}): PlanWebsiteLeadResult {
  const names = splitName(input.name);
  if ("error" in names) {
    return { ok: false, status: 400, code: "INVALID_NAME", message: names.error };
  }

  if (!input.existing) {
    return {
      ok: true,
      action: "create",
      firstName: names.firstName,
      lastName: names.lastName,
      notes: formatWebsiteLeadNotes({
        message: input.message,
        linkedinUrl: input.linkedinUrl,
        yearsExperience: input.yearsExperience,
      }),
    };
  }

  return {
    ok: true,
    action: "update",
    personId: input.existing.id,
    notes: appendWebsiteLeadMessage(input.existingNotes, input.message),
    ensureAllocationCard:
      !input.existing.hasAllocationCard &&
      !input.existing.doNotContact &&
      !input.existing.deleted,
    setProgramTrackAllocation:
      !input.existing.doNotContact && !input.existing.deleted,
  };
}
