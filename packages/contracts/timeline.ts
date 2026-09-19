import { z } from "zod";
import { activitySchema, type Activity } from "./activities";
import {
  emailThreadWithMessagesSchema,
  type EmailThreadWithMessages,
} from "./email-threads";
import { isoDateTimeSchema, type MeetingOutcome } from "./enums";

export const timelineItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("activity"),
    occurredAt: isoDateTimeSchema,
    activity: activitySchema,
  }),
  z.object({
    kind: z.literal("email"),
    occurredAt: isoDateTimeSchema,
    thread: emailThreadWithMessagesSchema,
  }),
]);
export type TimelineItem = z.infer<typeof timelineItemSchema>;

const KIND_ORDER: Record<TimelineItem["kind"], number> = {
  activity: 0,
  email: 1,
};

const MEETING_OUTCOME_LABEL: Record<MeetingOutcome, string> = {
  scheduled: "scheduled",
  held: "held",
  no_show: "no-show",
  rescheduled: "rescheduled",
};

/**
 * Operator-facing last-contact events. Audit still writes every mutation;
 * only these `payload.what` values (plus email threads) belong on the
 * person timeline.
 */
export const CONTACT_TIMELINE_WHATS = [
  "note",
  "task.complete",
  "meeting.outcome",
  "meeting.scheduled",
  "outbound.sent",
  "webhook.application",
  "website.lead.create",
] as const;
export type ContactTimelineWhat = (typeof CONTACT_TIMELINE_WHATS)[number];

const CONTACT_TIMELINE_WHAT_SET = new Set<string>(CONTACT_TIMELINE_WHATS);

export function isContactTimelineActivity(
  activity: Pick<Activity, "type" | "payload">,
): boolean {
  const what =
    typeof activity.payload.what === "string" ? activity.payload.what : "";
  if (what) {
    return CONTACT_TIMELINE_WHAT_SET.has(what);
  }
  return activity.type === "note" || activity.type === "meeting";
}

export function taskGuidePayloadsFromActivities(
  activities: Activity[],
): Activity["payload"][] {
  return activities
    .filter((activity) => {
      const what =
        typeof activity.payload.what === "string" ? activity.payload.what : "";
      return what === "task.complete" || what === "task.create";
    })
    .map((activity) => activity.payload);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function describeContactTimelineActivity(
  payload: Record<string, unknown>,
): string | null {
  const what = typeof payload.what === "string" ? payload.what : "";
  const after = asRecord(payload.after);

  if (what === "meeting.scheduled") {
    return "Meeting scheduled";
  }
  if (what === "meeting.outcome") {
    const outcome = after?.outcome;
    if (
      outcome === "scheduled" ||
      outcome === "held" ||
      outcome === "no_show" ||
      outcome === "rescheduled"
    ) {
      return `Meeting ${MEETING_OUTCOME_LABEL[outcome]}`;
    }
    return "Meeting outcome";
  }
  if (what === "outbound.sent") {
    return "Campaign email sent";
  }
  if (what === "webhook.application") {
    return "Website application";
  }
  if (what === "website.lead.create") {
    return "Website inquiry";
  }
  return null;
}

export function mergePersonTimeline(input: {
  activities: Activity[];
  threads: EmailThreadWithMessages[];
}): TimelineItem[] {
  const items: TimelineItem[] = [
    ...input.activities
      .filter(isContactTimelineActivity)
      .map((activity) => ({
        kind: "activity" as const,
        occurredAt: activity.occurredAt,
        activity,
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
