import { z } from "zod";
import {
  emailSchema,
  isoDateTimeSchema,
  mailboxSchema,
  type Mailbox,
} from "./enums";

export const PERSONAL_MAILBOX_EMAIL = "nathan@realmlabs.co";
export const PARTNER_MAILBOX_EMAIL = "stefano@realmlabs.co";

export const MAILBOX_ADDRESSES: Record<Mailbox, string> = {
  personal: PERSONAL_MAILBOX_EMAIL,
  partner: PARTNER_MAILBOX_EMAIL,
};

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

/** Operator mailboxes shown in Settings and allowed to Connect. */
export const CONFIGURED_MAILBOXES: readonly ConfiguredMailbox[] = [
  {
    email: PERSONAL_MAILBOX_EMAIL,
    mailbox: "personal",
    label: "Nathan",
  },
  {
    email: PARTNER_MAILBOX_EMAIL,
    mailbox: "partner",
    label: "Stefano",
  },
];

export const ALL_MAILBOXES: readonly Mailbox[] = ["personal", "partner"];

export function isConfiguredMailbox(mailbox: Mailbox): boolean {
  return CONFIGURED_MAILBOXES.some((item) => item.mailbox === mailbox);
}

export function mailboxEmailFor(mailbox: Mailbox): string {
  return MAILBOX_ADDRESSES[mailbox];
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
  mailbox: mailboxSchema,
});
export type CalendarSyncJobData = z.infer<typeof calendarSyncJobDataSchema>;
