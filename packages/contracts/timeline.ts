import { z } from "zod";
import { activitySchema, type Activity } from "./activities";
import { emailThreadSchema, type EmailThread } from "./email-threads";
import { isoDateTimeSchema } from "./enums";
import { meetingSchema, type Meeting } from "./meetings";

export const timelineItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("activity"),
    occurredAt: isoDateTimeSchema,
    activity: activitySchema,
  }),
  z.object({
    kind: z.literal("meeting"),
    occurredAt: isoDateTimeSchema,
    meeting: meetingSchema,
  }),
  z.object({
    kind: z.literal("email"),
    occurredAt: isoDateTimeSchema,
    thread: emailThreadSchema,
  }),
]);
export type TimelineItem = z.infer<typeof timelineItemSchema>;

const KIND_ORDER: Record<TimelineItem["kind"], number> = {
  activity: 0,
  meeting: 1,
  email: 2,
};

export function mergePersonTimeline(input: {
  activities: Activity[];
  meetings: Meeting[];
  threads: EmailThread[];
}): TimelineItem[] {
  const items: TimelineItem[] = [
    ...input.activities.map((activity) => ({
      kind: "activity" as const,
      occurredAt: activity.occurredAt,
      activity,
    })),
    ...input.meetings.map((meeting) => ({
      kind: "meeting" as const,
      occurredAt: meeting.scheduledAt,
      meeting,
    })),
    ...input.threads.map((thread) => ({
      kind: "email" as const,
      occurredAt: thread.lastMessageAt,
      thread,
    })),
  ];

  items.sort((a, b) => {
    const byTime = b.occurredAt.localeCompare(a.occurredAt);
    if (byTime !== 0) {
      return byTime;
    }
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });

  return items;
}
