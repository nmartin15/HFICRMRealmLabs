import { z } from "zod";
import { emailSchema, isoDateTimeSchema, uuidSchema } from "./enums";

export const emailMessageDirectionSchema = z.enum([
  "inbound",
  "outbound",
  "other",
]);
export type EmailMessageDirection = z.infer<typeof emailMessageDirectionSchema>;

export const emailMessageSchema = z.object({
  id: uuidSchema,
  threadId: uuidSchema,
  gmailMessageId: z.string().min(1),
  fromEmail: z.string(),
  toEmails: z.array(emailSchema),
  ccEmails: z.array(emailSchema),
  sentAt: isoDateTimeSchema,
  bodyText: z.string(),
  snippet: z.string().nullable(),
  direction: emailMessageDirectionSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type EmailMessage = z.infer<typeof emailMessageSchema>;
