import { z } from "zod";
import {
  emailsMatch,
  isMailboxAddress,
  mailboxEmails,
} from "./email-matching";
import {
  isoDateTimeSchema,
  meetingOutcomeSchema,
  uuidSchema,
  type MeetingOutcome,
} from "./enums";

export const HAND_SET_MEETING_OUTCOMES = [
  "held",
  "no_show",
  "rescheduled",
] as const;

export const handSetMeetingOutcomeSchema = z.enum(HAND_SET_MEETING_OUTCOMES);
export type HandSetMeetingOutcome = z.infer<typeof handSetMeetingOutcomeSchema>;

export const meetingSchema = z.object({
  id: uuidSchema,
  personId: uuidSchema,
  scheduledAt: isoDateTimeSchema,
  calendarEventId: z.string().nullable(),
  outcome: meetingOutcomeSchema,
  needsReview: z.boolean(),
  notes: z.string().nullable(),
  createdBy: uuidSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Meeting = z.infer<typeof meetingSchema>;

export const meetingIdParamsSchema = z.object({
  id: uuidSchema,
});
export type MeetingIdParams = z.infer<typeof meetingIdParamsSchema>;

export const meetingOutcomePatchSchema = z.object({
  outcome: handSetMeetingOutcomeSchema,
});
export type MeetingOutcomePatch = z.infer<typeof meetingOutcomePatchSchema>;

export const meetingDigestPersonSchema = z.object({
  id: uuidSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().min(1),
});
export type MeetingDigestPerson = z.infer<typeof meetingDigestPersonSchema>;

export const meetingDigestItemSchema = z.object({
  meeting: meetingSchema,
  person: meetingDigestPersonSchema,
});
export type MeetingDigestItem = z.infer<typeof meetingDigestItemSchema>;

export const meetingDigestResponseSchema = z.object({
  data: z.array(meetingDigestItemSchema),
});
export type MeetingDigestResponse = z.infer<typeof meetingDigestResponseSchema>;

export type CalendarAttendee = {
  email?: string | null;
  responseStatus?: string | null;
};

/** True when a non-mailbox attendee matching the person accepted. */
export function calendarEventAttendeeAccepted(input: {
  attendees: readonly CalendarAttendee[];
  personEmails: readonly string[];
  mailboxAddresses?: readonly string[];
}): boolean {
  if (input.personEmails.length === 0) {
    return false;
  }
  const mailboxes = input.mailboxAddresses ?? mailboxEmails();
  return input.attendees.some((attendee) => {
    const email = attendee.email?.trim();
    if (!email || isMailboxAddress(email, mailboxes)) {
      return false;
    }
    if (!input.personEmails.some((known) => emailsMatch(known, email))) {
      return false;
    }
    return attendee.responseStatus === "accepted";
  });
}

/**
 * Locked for calibration: explicit no-show or reschedule is not held.
 * Explicit held is held. Otherwise a past-dated event whose matched
 * attendee accepted counts as held. An unset dropdown is absence of
 * evidence (nobody maintained the field), not evidence of a miss.
 */
export function meetingHeldForScore(input: {
  outcome: MeetingOutcome | null;
  scheduledAt: number;
  asOf: number;
  attendeeAccepted: boolean;
}): boolean {
  if (input.outcome === "no_show" || input.outcome === "rescheduled") {
    return false;
  }
  if (input.outcome === "held") {
    return true;
  }
  return input.scheduledAt < input.asOf && input.attendeeAccepted;
}
