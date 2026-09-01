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
  taskKindSchema,
  uuidSchema,
} from "./enums";
import type { IncubatorStage } from "./enums";
import { TASK_KIND_LABELS } from "./tasks";
import {
  meetingDigestItemSchema,
  meetingDigestPersonSchema,
  type MeetingDigestItem,
} from "./meetings";

export const HOME_TODO_KINDS = [
  "close_meeting",
  "task",
  "email",
  "call",
  "decision",
  "incubator",
] as const;

export const homeTodoKindSchema = z.enum(HOME_TODO_KINDS);
export type HomeTodoKind = z.infer<typeof homeTodoKindSchema>;

const KIND_ORDER: Record<HomeTodoKind, number> = {
  close_meeting: 0,
  task: 1,
  email: 2,
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

export const homeIncubatorInputSchema = z.object({
  person: meetingDigestPersonSchema,
  stage: z.enum(["applied"]),
});
export type HomeIncubatorInput = z.infer<typeof homeIncubatorInputSchema>;

export const homeOpenTaskInputSchema = z.object({
  id: uuidSchema,
  person: meetingDigestPersonSchema,
  kind: taskKindSchema,
  dueAt: isoDateTimeSchema,
  notes: z.string().nullable(),
});
export type HomeOpenTaskInput = z.infer<typeof homeOpenTaskInputSchema>;

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

export function isIncubatorWaitingStage(
  stage: IncubatorStage,
): stage is "applied" {
  return stage === "applied";
}

function todo(
  partial: HomeTodo,
): HomeTodo {
  return homeTodoSchema.parse(partial);
}

export function buildHomeTodos(input: {
  leftoverMeetings: MeetingDigestItem[];
  todayMeetings: MeetingDigestItem[];
  openTasks: HomeOpenTaskInput[];
  unmatchedEmails: Array<{
    id: string;
    subject: string;
    lastMessageAt: string;
    snippet: string | null;
  }>;
  callsDue: HomeCallInput[];
  decisions: HomeDecisionInput[];
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

  for (const item of input.openTasks) {
    items.push(
      todo({
        id: `task:${item.id}`,
        kind: "task",
        href: `/people/${item.person.id}`,
        title: personDisplayName(item.person),
        detail: item.notes
          ? `${TASK_KIND_LABELS[item.kind]} · ${item.notes}`
          : TASK_KIND_LABELS[item.kind],
        at: item.dueAt,
        meetingId: null,
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
