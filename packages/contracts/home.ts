import { z } from "zod";
import {
  ALLOCATION_STAGE_LABELS,
  INCUBATOR_STAGE_LABELS,
  personDisplayName,
} from "./allocation";
import { emailThreadSchema } from "./email-threads";
import {
  isoDateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./enums";
import type { IncubatorStage } from "./enums";
import {
  meetingDigestItemSchema,
  meetingDigestPersonSchema,
  type MeetingDigestItem,
} from "./meetings";
import { zonedIsoDate } from "./time";

export const HOME_TODO_KINDS = [
  "close_meeting",
  "email",
  "nurture",
  "call",
  "decision",
  "incubator",
] as const;

export const homeTodoKindSchema = z.enum(HOME_TODO_KINDS);
export type HomeTodoKind = z.infer<typeof homeTodoKindSchema>;

const KIND_ORDER: Record<HomeTodoKind, number> = {
  close_meeting: 0,
  email: 1,
  nurture: 2,
  call: 3,
  decision: 4,
  incubator: 5,
};

export const homeTodoSchema = z.object({
  id: z.string().min(1),
  kind: homeTodoKindSchema,
  href: z.string().min(1),
  title: z.string().min(1),
  detail: z.string(),
  at: isoDateTimeSchema.nullable(),
  meetingId: uuidSchema.nullable(),
});
export type HomeTodo = z.infer<typeof homeTodoSchema>;

export const homeEmailItemSchema = z.object({
  thread: emailThreadSchema,
  person: meetingDigestPersonSchema.nullable(),
});
export type HomeEmailItem = z.infer<typeof homeEmailItemSchema>;

export const homeCallInputSchema = z.object({
  person: meetingDigestPersonSchema,
  stageLabel: z.string().min(1),
});
export type HomeCallInput = z.infer<typeof homeCallInputSchema>;

export const homeDecisionInputSchema = z.object({
  person: meetingDigestPersonSchema,
});
export type HomeDecisionInput = z.infer<typeof homeDecisionInputSchema>;

export const homeNurtureInputSchema = z.object({
  person: meetingDigestPersonSchema,
  followUpAt: isoDateSchema.nullable(),
});
export type HomeNurtureInput = z.infer<typeof homeNurtureInputSchema>;

export const homeIncubatorInputSchema = z.object({
  person: meetingDigestPersonSchema,
  stage: z.enum(["application_received", "offer_made"]),
});
export type HomeIncubatorInput = z.infer<typeof homeIncubatorInputSchema>;

export const homeSnapshotResponseSchema = z.object({
  date: isoDateSchema,
  todos: z.array(homeTodoSchema),
  schedule: z.array(meetingDigestItemSchema),
  emails: z.array(homeEmailItemSchema),
  counts: z.object({
    todo: z.number().int().nonnegative(),
    meetings: z.number().int().nonnegative(),
    calls: z.number().int().nonnegative(),
    emails: z.number().int().nonnegative(),
  }),
});
export type HomeSnapshotResponse = z.infer<typeof homeSnapshotResponseSchema>;

export function meetingNeedsOutcome(
  scheduledAt: string,
  outcome: string,
  now: Date,
): boolean {
  return outcome === "scheduled" && new Date(scheduledAt).getTime() <= now.getTime();
}

export function isNurtureDue(
  followUpAt: string | null,
  todayYmd: string,
): boolean {
  return followUpAt === null || followUpAt <= todayYmd;
}

export function isIncubatorWaitingStage(
  stage: IncubatorStage,
): stage is "application_received" | "offer_made" {
  return stage === "application_received" || stage === "offer_made";
}

function todo(
  partial: HomeTodo,
): HomeTodo {
  return homeTodoSchema.parse(partial);
}

export function buildHomeTodos(input: {
  leftoverMeetings: MeetingDigestItem[];
  todayMeetings: MeetingDigestItem[];
  unmatchedEmails: Array<{
    id: string;
    subject: string;
    lastMessageAt: string;
    snippet: string | null;
  }>;
  callsDue: HomeCallInput[];
  decisions: HomeDecisionInput[];
  nurtureDue: HomeNurtureInput[];
  incubatorWaiting: HomeIncubatorInput[];
  now: Date;
}): HomeTodo[] {
  const items: HomeTodo[] = [];

  for (const item of input.leftoverMeetings) {
    items.push(
      todo({
        id: `close-meeting:${item.meeting.id}`,
        kind: "close_meeting",
        href: `/people/${item.person.id}`,
        title: personDisplayName(item.person),
        detail: "Close leftover call",
        at: item.meeting.scheduledAt,
        meetingId: item.meeting.id,
      }),
    );
  }

  for (const item of input.todayMeetings) {
    if (
      !meetingNeedsOutcome(
        item.meeting.scheduledAt,
        item.meeting.outcome,
        input.now,
      )
    ) {
      continue;
    }
    items.push(
      todo({
        id: `close-meeting:${item.meeting.id}`,
        kind: "close_meeting",
        href: `/people/${item.person.id}`,
        title: personDisplayName(item.person),
        detail: "Close today's call",
        at: item.meeting.scheduledAt,
        meetingId: item.meeting.id,
      }),
    );
  }

  for (const thread of input.unmatchedEmails) {
    items.push(
      todo({
        id: `email:${thread.id}`,
        kind: "email",
        href: "/inbox/unmatched",
        title: thread.subject || "(no subject)",
        detail: thread.snippet ?? "Unmatched email",
        at: thread.lastMessageAt,
        meetingId: null,
      }),
    );
  }

  const todayYmd = zonedIsoDate(input.now);
  for (const item of input.nurtureDue) {
    if (!isNurtureDue(item.followUpAt, todayYmd)) {
      continue;
    }
    items.push(
      todo({
        id: `nurture:${item.person.id}`,
        kind: "nurture",
        href: `/people/${item.person.id}`,
        title: personDisplayName(item.person),
        detail: item.followUpAt
          ? `Nurture follow-up ${item.followUpAt}`
          : "Nurture follow-up due",
        at: item.followUpAt ? `${item.followUpAt}T12:00:00.000Z` : null,
        meetingId: null,
      }),
    );
  }

  for (const item of input.callsDue) {
    items.push(
      todo({
        id: `call:${item.person.id}`,
        kind: "call",
        href: `/people/${item.person.id}`,
        title: personDisplayName(item.person),
        detail: `Call · ${item.stageLabel}`,
        at: null,
        meetingId: null,
      }),
    );
  }

  for (const item of input.decisions) {
    items.push(
      todo({
        id: `decision:${item.person.id}`,
        kind: "decision",
        href: `/people/${item.person.id}`,
        title: personDisplayName(item.person),
        detail: `Task · ${ALLOCATION_STAGE_LABELS.decision}`,
        at: null,
        meetingId: null,
      }),
    );
  }

  for (const item of input.incubatorWaiting) {
    items.push(
      todo({
        id: `incubator:${item.person.id}`,
        kind: "incubator",
        href: `/people/${item.person.id}`,
        title: personDisplayName(item.person),
        detail: `Task · ${INCUBATOR_STAGE_LABELS[item.stage]}`,
        at: null,
        meetingId: null,
      }),
    );
  }

  items.sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) {
      return byKind;
    }
    return (a.at ?? "").localeCompare(b.at ?? "");
  });

  return items;
}

export function homeCounts(input: {
  todos: HomeTodo[];
  leftoverCount: number;
  scheduleCount: number;
  emailCount: number;
}): HomeSnapshotResponse["counts"] {
  const meetings = input.leftoverCount + input.scheduleCount;
  return {
    todo: input.todos.length,
    meetings,
    calls:
      input.todos.filter((item) => item.kind === "call").length + meetings,
    emails:
      input.todos.filter((item) => item.kind === "email").length +
      input.emailCount,
  };
}
