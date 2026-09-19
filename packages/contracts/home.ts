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
import {
  TASK_KIND_LABELS,
  hasExistingOpenFollowUp,
  taskSchema,
  type OpenTaskSibling,
} from "./tasks";
import {
  meetingDigestPersonSchema,
  type MeetingDigestPerson,
} from "./meetings";
import { UNKNOWN_PERSON_NAME } from "./webhooks";
import { homeDeliverabilitySchema } from "./deliverability";

export const HOME_TODO_KINDS = [
  "close_meeting",
  "campaign_review",
  "needs_track",
  "needs_review",
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
  campaign_review: 1,
  needs_track: 2,
  needs_review: 3,
  task: 4,
  email: 5,
  call: 6,
  decision: 7,
  incubator: 8,
};

export const HOME_TODO_GROUPS = [
  "close_calls",
  "follow_ups",
  "decisions",
  "mail",
] as const;
export type HomeTodoGroup = (typeof HOME_TODO_GROUPS)[number];

export function homeTodoGroup(kind: HomeTodoKind): HomeTodoGroup {
  if (kind === "close_meeting") {
    return "close_calls";
  }
  if (kind === "task") {
    return "follow_ups";
  }
  if (kind === "email") {
    return "mail";
  }
  return "decisions";
}

export function groupHomeTodos(todos: HomeTodo[]): {
  closeCalls: HomeTodo[];
  followUps: HomeTodo[];
  decisions: HomeTodo[];
  mail: HomeTodo[];
} {
  const closeCalls: HomeTodo[] = [];
  const followUps: HomeTodo[] = [];
  const decisions: HomeTodo[] = [];
  const mail: HomeTodo[] = [];
  for (const item of todos) {
    const group = homeTodoGroup(item.kind);
    if (group === "close_calls") {
      closeCalls.push(item);
    } else if (group === "follow_ups") {
      followUps.push(item);
    } else if (group === "mail") {
      mail.push(item);
    } else {
      decisions.push(item);
    }
  }
  return { closeCalls, followUps, decisions, mail };
}

export const homeTodoSchema = z.object({
  id: z.string().min(1),
  kind: homeTodoKindSchema,
  href: z.string().min(1),
  title: z.string().min(1),
  detail: z.string(),
  at: isoDateTimeSchema.nullable(),
  taskId: uuidSchema.nullable(),
  personId: uuidSchema.nullable(),
  hasOpenFollowUp: z.boolean().default(false),
});
export type HomeTodo = z.infer<typeof homeTodoSchema>;

export const homeEmailItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("task"),
    task: taskSchema,
    person: meetingDigestPersonSchema,
  }),
  z.object({
    kind: z.literal("thread"),
    thread: emailThreadSchema,
    person: meetingDigestPersonSchema.nullable(),
  }),
]);
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

export const homePersonInputSchema = z.object({
  person: meetingDigestPersonSchema,
  firstName: z.string(),
  lastName: z.string(),
  needsReview: z.boolean(),
});
export type HomePersonInput = z.infer<typeof homePersonInputSchema>;

export const homeScheduleItemSchema = z.object({
  task: taskSchema,
  person: meetingDigestPersonSchema,
});
export type HomeScheduleItem = z.infer<typeof homeScheduleItemSchema>;

export const homeSnapshotResponseSchema = z.object({
  date: isoDateSchema,
  todos: z.array(homeTodoSchema),
  schedule: z.array(homeScheduleItemSchema),
  emails: z.array(homeEmailItemSchema),
  counts: z.object({
    todo: z.number().int().nonnegative(),
    meetings: z.number().int().nonnegative(),
    calls: z.number().int().nonnegative(),
    emails: z.number().int().nonnegative(),
  }),
  deliverability: homeDeliverabilitySchema,
});
export type HomeSnapshotResponse = z.infer<typeof homeSnapshotResponseSchema>;

export function meetingTaskNeedsOutcome(
  dueAt: string,
  status: string,
  now: Date,
  needsReview = false,
): boolean {
  if (status !== "open") {
    return false;
  }
  if (needsReview) {
    return true;
  }
  return new Date(dueAt).getTime() <= now.getTime();
}

export function isIncubatorWaitingStage(
  stage: IncubatorStage,
): stage is "applied" {
  return stage === "applied";
}

function todo(partial: z.input<typeof homeTodoSchema>): HomeTodo {
  return homeTodoSchema.parse(partial);
}

export function reviewTodoDetail(input: {
  firstName: string;
  lastName: string;
  needsReview: boolean;
}): string {
  const missingName =
    input.firstName === UNKNOWN_PERSON_NAME ||
    input.lastName === UNKNOWN_PERSON_NAME;
  if (missingName) {
    return "Name missing";
  }
  return "Application webhook: unexpected stage";
}

export function buildHomeTodos(input: {
  leftoverMeetings: HomeScheduleItem[];
  todayMeetings: HomeScheduleItem[];
  openTasks: HomeOpenTaskInput[];
  allOpenTasks?: Array<OpenTaskSibling & { personId: string }>;
  unmatchedEmails: Array<{
    id: string;
    subject: string;
    lastMessageAt: string;
    snippet: string | null;
  }>;
  callsDue: HomeCallInput[];
  decisions: HomeDecisionInput[];
  incubatorWaiting: HomeIncubatorInput[];
  needsTrack: MeetingDigestPerson[];
  needsReview: HomePersonInput[];
  campaignReview: MeetingDigestPerson[];
  now: Date;
}): HomeTodo[] {
  const items: HomeTodo[] = [];
  const allOpenTasks = input.allOpenTasks ?? [];

  function closeMeetingHasFollowUp(item: HomeScheduleItem): boolean {
    return hasExistingOpenFollowUp({
      currentId: item.task.id,
      currentKind: item.task.kind,
      currentDueAt: item.task.dueAt,
      currentCalendarEventId: item.task.calendarEventId,
      otherOpenTasks: allOpenTasks.filter(
        (task) => task.personId === item.person.id && task.id !== item.task.id,
      ),
    });
  }

  for (const item of input.leftoverMeetings) {
    items.push(
      todo({
        id: `close-meeting:${item.task.id}`,
        kind: "close_meeting",
        href: `/people/${item.person.id}`,
        title: personDisplayName(item.person),
        detail: "Log leftover call outcome",
        at: item.task.dueAt,
        taskId: item.task.id,
        personId: item.person.id,
        hasOpenFollowUp: closeMeetingHasFollowUp(item),
      }),
    );
  }

  for (const item of input.todayMeetings) {
    if (
      !meetingTaskNeedsOutcome(
        item.task.dueAt,
        item.task.status,
        input.now,
        item.task.needsReview,
      )
    ) {
      continue;
    }
    items.push(
      todo({
        id: `close-meeting:${item.task.id}`,
        kind: "close_meeting",
        href: `/people/${item.person.id}`,
        title: personDisplayName(item.person),
        detail: "Log today's call outcome",
        at: item.task.dueAt,
        taskId: item.task.id,
        personId: item.person.id,
        hasOpenFollowUp: closeMeetingHasFollowUp(item),
      }),
    );
  }

  for (const person of input.campaignReview) {
    items.push(
      todo({
        id: `campaign-review:${person.id}`,
        kind: "campaign_review",
        href: `/people/${person.id}`,
        title: personDisplayName(person),
        detail: "Release hot sequence",
        at: null,
        taskId: null,
        personId: person.id,
      }),
    );
  }

  for (const person of input.needsTrack) {
    items.push(
      todo({
        id: `needs-track:${person.id}`,
        kind: "needs_track",
        href: `/people/${person.id}`,
        title: personDisplayName(person),
        detail: "Set program track",
        at: null,
        taskId: null,
        personId: person.id,
      }),
    );
  }

  for (const item of input.needsReview) {
    items.push(
      todo({
        id: `needs-review:${item.person.id}`,
        kind: "needs_review",
        href: `/people/${item.person.id}`,
        title: personDisplayName(item.person),
        detail: reviewTodoDetail(item),
        at: null,
        taskId: null,
        personId: item.person.id,
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
        taskId: item.id,
        personId: item.person.id,
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
        taskId: null,
        personId: null,
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
        taskId: null,
        personId: item.person.id,
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
        taskId: null,
        personId: item.person.id,
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
        taskId: null,
        personId: item.person.id,
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
