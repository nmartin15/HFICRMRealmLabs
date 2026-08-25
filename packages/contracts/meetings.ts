import { z } from "zod";
import {
  isoDateTimeSchema,
  meetingOutcomeSchema,
  uuidSchema,
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

export const meetingInsertSchema = meetingSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    outcome: meetingOutcomeSchema.default("scheduled"),
    needsReview: z.boolean().default(false),
  });
export type MeetingInsert = z.infer<typeof meetingInsertSchema>;

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
