import { z } from "zod";
import {
  emailSchema,
  isoDateTimeSchema,
  mailboxSchema,
  uuidSchema,
} from "./enums";

export const emailThreadSchema = z.object({
  id: uuidSchema,
  personId: uuidSchema.nullable(),
  mailbox: mailboxSchema,
  gmailThreadId: z.string().min(1),
  subject: z.string(),
  lastMessageAt: isoDateTimeSchema,
  snippet: z.string().nullable(),
  participantEmails: z.array(emailSchema),
  sharedVisible: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type EmailThread = z.infer<typeof emailThreadSchema>;

export const emailThreadInsertSchema = emailThreadSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    sharedVisible: z.boolean().default(false),
  });
export type EmailThreadInsert = z.infer<typeof emailThreadInsertSchema>;

export const emailThreadListResponseSchema = z.object({
  data: z.array(emailThreadSchema),
});
export type EmailThreadListResponse = z.infer<
  typeof emailThreadListResponseSchema
>;

export const emailThreadIdParamsSchema = z.object({
  id: uuidSchema,
});
export type EmailThreadIdParams = z.infer<typeof emailThreadIdParamsSchema>;

export const linkEmailThreadBodySchema = z.object({
  personId: uuidSchema,
});
export type LinkEmailThreadBody = z.infer<typeof linkEmailThreadBodySchema>;
