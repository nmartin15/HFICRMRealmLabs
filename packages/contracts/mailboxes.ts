import { z } from "zod";
import { emailSchema, isoDateTimeSchema, mailboxSchema } from "./enums";

export const PERSONAL_MAILBOX_EMAIL = "nathan@realmlabs.co";
export const SHARED_MAILBOX_EMAIL = "application@realmlabs.co";

export const GMAIL_SYNC_QUEUE = "gmail.sync";
export const CALENDAR_SYNC_QUEUE = "calendar.sync";
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
export const CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

export const configuredMailboxSchema = z.object({
  email: emailSchema,
  mailbox: mailboxSchema,
  label: z.string().min(1),
});
export type ConfiguredMailbox = z.infer<typeof configuredMailboxSchema>;

export const CONFIGURED_MAILBOXES: readonly ConfiguredMailbox[] = [
  {
    email: PERSONAL_MAILBOX_EMAIL,
    mailbox: "personal",
    label: "Personal",
  },
  {
    email: SHARED_MAILBOX_EMAIL,
    mailbox: "shared",
    label: "Shared applications",
  },
];

export function mailboxEmailFor(mailbox: "personal" | "shared"): string {
  const row = CONFIGURED_MAILBOXES.find((item) => item.mailbox === mailbox);
  if (!row) {
    throw new Error(`Unknown mailbox: ${mailbox}`);
  }
  return row.email;
}

export const mailboxConnectionSchema = configuredMailboxSchema.extend({
  connected: z.boolean(),
  lastSyncedAt: isoDateTimeSchema.nullable(),
  lastError: z.string().nullable(),
  connectedAt: isoDateTimeSchema.nullable(),
});
export type MailboxConnection = z.infer<typeof mailboxConnectionSchema>;

export const mailboxConnectionListResponseSchema = z.object({
  data: z.array(mailboxConnectionSchema),
});
export type MailboxConnectionListResponse = z.infer<
  typeof mailboxConnectionListResponseSchema
>;

export const mailboxParamsSchema = z.object({
  mailbox: mailboxSchema,
});
export type MailboxParams = z.infer<typeof mailboxParamsSchema>;

export const gmailSyncJobDataSchema = z.object({
  mailbox: mailboxSchema,
});
export type GmailSyncJobData = z.infer<typeof gmailSyncJobDataSchema>;

export const calendarSyncJobDataSchema = z.object({
  mailbox: z.literal("personal"),
});
export type CalendarSyncJobData = z.infer<typeof calendarSyncJobDataSchema>;
