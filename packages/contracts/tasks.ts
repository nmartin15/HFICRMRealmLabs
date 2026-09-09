import { z } from "zod";
import {
  isoDateTimeSchema,
  meetingOutcomeSchema,
  taskKindSchema,
  taskStatusSchema,
  uuidSchema,
  type MeetingOutcome,
  type TaskKind,
  type TaskStatus,
} from "./enums";
import { HAND_SET_MEETING_OUTCOMES, handSetMeetingOutcomeSchema } from "./meetings";

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  email: "Email",
  call: "Call",
  meeting: "Meeting",
  dnc: "DNC",
};

export const taskSchema = z.object({
  id: uuidSchema,
  personId: uuidSchema,
  kind: taskKindSchema,
  dueAt: isoDateTimeSchema,
  notes: z.string().nullable(),
  status: taskStatusSchema,
  calendarEventId: z.string().nullable(),
  outcome: meetingOutcomeSchema.nullable(),
  needsReview: z.boolean(),
  createdBy: uuidSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Task = z.infer<typeof taskSchema>;

export const createTaskBodySchema = z.object({
  kind: taskKindSchema,
  dueAt: isoDateTimeSchema,
  notes: z.string().trim().optional(),
});
export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;

export const updateTaskBodySchema = z.object({
  kind: taskKindSchema.optional(),
  dueAt: isoDateTimeSchema.optional(),
  notes: z.string().trim().nullable().optional(),
});
export type UpdateTaskBody = z.infer<typeof updateTaskBodySchema>;

export const completeTaskBodySchema = z.object({
  notes: z.string().trim().optional(),
  outcome: handSetMeetingOutcomeSchema.optional(),
  next: z
    .object({
      kind: taskKindSchema,
      dueAt: isoDateTimeSchema,
      notes: z.string().trim().optional(),
    })
    .optional(),
});
export type CompleteTaskBody = z.infer<typeof completeTaskBodySchema>;

export const personTasksResponseSchema = z.object({
  data: z.array(taskSchema),
});
export type PersonTasksResponse = z.infer<typeof personTasksResponseSchema>;

export const taskIdParamsSchema = z.object({
  personId: uuidSchema,
  taskId: uuidSchema,
});
export type TaskIdParams = z.infer<typeof taskIdParamsSchema>;

export type PlanTaskWriteInput = {
  kind: TaskKind;
  notes: string | null | undefined;
  personDoNotContact: boolean;
  personDeleted: boolean;
};

export type PlanTaskWriteError = {
  ok: false;
  status: 400 | 409;
  code: string;
  message: string;
};

export type PlanCreateTaskSuccess = {
  ok: true;
  kind: TaskKind;
  notes: string | null;
  setDoNotContact: boolean;
};

export type PlanCompleteTaskSuccess = {
  ok: true;
  notes: string | null;
  setDoNotContact: boolean;
  status: Extract<TaskStatus, "done" | "rescheduled">;
  outcome: MeetingOutcome | null;
  next: {
    kind: TaskKind;
    dueAt: string;
    notes: string | null;
  } | null;
};

function fail(
  status: 400 | 409,
  code: string,
  message: string,
): PlanTaskWriteError {
  return { ok: false, status, code, message };
}

function notesOrNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function planCreateTask(
  input: PlanTaskWriteInput,
): PlanCreateTaskSuccess | PlanTaskWriteError {
  if (input.personDeleted) {
    return fail(409, "PERSON_DELETED", "Person is deleted");
  }
  if (input.personDoNotContact && input.kind !== "dnc") {
    return fail(
      409,
      "DO_NOT_CONTACT",
      "Person is marked do not contact",
    );
  }
  const notes = notesOrNull(input.notes);
  if (input.kind === "dnc" && !notes) {
    return fail(400, "DNC_REASON_REQUIRED", "DNC requires a reason in notes");
  }
  return {
    ok: true,
    kind: input.kind,
    notes,
    setDoNotContact: input.kind === "dnc",
  };
}

export type PlanUpdateTaskSuccess = {
  ok: true;
  kind: TaskKind;
  dueAt: string;
  notes: string | null;
  outcome: MeetingOutcome | null;
  setDoNotContact: boolean;
  changed: boolean;
};

export function planUpdateTask(input: {
  currentStatus: string;
  currentKind: TaskKind;
  currentDueAt: string;
  currentNotes: string | null;
  currentOutcome: MeetingOutcome | null;
  personDeleted: boolean;
  kind?: TaskKind;
  dueAt?: string;
  notes?: string | null;
}): PlanUpdateTaskSuccess | PlanTaskWriteError {
  if (input.personDeleted) {
    return fail(409, "PERSON_DELETED", "Person is deleted");
  }

  const kind = input.kind ?? input.currentKind;
  const dueAt = input.dueAt ?? input.currentDueAt;
  const notes =
    input.notes === undefined
      ? input.currentNotes
      : notesOrNull(input.notes);

  if (kind === "dnc" && !notes) {
    return fail(400, "DNC_REASON_REQUIRED", "DNC requires a reason in notes");
  }

  let outcome: MeetingOutcome | null = input.currentOutcome;
  if (kind !== "meeting") {
    outcome = null;
  } else if (input.currentKind !== "meeting" && input.currentStatus === "open") {
    outcome = "scheduled";
  }

  return {
    ok: true,
    kind,
    dueAt,
    notes,
    outcome,
    setDoNotContact: kind === "dnc",
    changed:
      kind !== input.currentKind ||
      dueAt !== input.currentDueAt ||
      notes !== input.currentNotes ||
      outcome !== input.currentOutcome,
  };
}

export function planCompleteTask(input: {
  currentKind: TaskKind;
  currentStatus: string;
  notes: string | null | undefined;
  outcome: (typeof HAND_SET_MEETING_OUTCOMES)[number] | undefined;
  next: { kind: TaskKind; dueAt: string; notes?: string } | undefined;
  personDoNotContact: boolean;
  personDeleted: boolean;
  otherOpenTaskCount?: number;
}): PlanCompleteTaskSuccess | PlanTaskWriteError {
  if (input.personDeleted) {
    return fail(409, "PERSON_DELETED", "Person is deleted");
  }
  if (input.currentStatus !== "open") {
    return fail(409, "TASK_NOT_OPEN", "Task is already closed");
  }

  const notes = notesOrNull(input.notes);
  const isDnc = input.currentKind === "dnc";

  if (isDnc) {
    if (!notes) {
      return fail(400, "DNC_REASON_REQUIRED", "DNC requires a reason in notes");
    }
    return {
      ok: true,
      notes,
      setDoNotContact: true,
      status: "done",
      outcome: null,
      next: null,
    };
  }

  if (input.currentKind === "meeting") {
    if (!input.outcome) {
      return fail(
        400,
        "MEETING_OUTCOME_REQUIRED",
        "Closing a meeting requires Held, No show, or Rescheduled",
      );
    }
  }

  const outcome = input.currentKind === "meeting" ? input.outcome ?? null : null;
  const status: Extract<TaskStatus, "done" | "rescheduled"> =
    outcome === "rescheduled" ? "rescheduled" : "done";

  if (input.personDoNotContact) {
    return {
      ok: true,
      notes,
      setDoNotContact: false,
      status,
      outcome,
      next: null,
    };
  }

  const otherOpenTaskCount = input.otherOpenTaskCount ?? 0;
  if (otherOpenTaskCount > 0) {
    return {
      ok: true,
      notes,
      setDoNotContact: false,
      status,
      outcome,
      next: null,
    };
  }

  if (!input.next) {
    return fail(
      400,
      "FOLLOW_UP_REQUIRED",
      "Closing a task requires a follow-up task",
    );
  }

  const nextNotes = notesOrNull(input.next.notes);
  if (input.next.kind === "dnc" && !nextNotes) {
    return fail(400, "DNC_REASON_REQUIRED", "DNC requires a reason in notes");
  }

  return {
    ok: true,
    notes,
    setDoNotContact: input.next.kind === "dnc",
    status,
    outcome,
    next: {
      kind: input.next.kind,
      dueAt: input.next.dueAt,
      notes: nextNotes,
    },
  };
}

function taskKindLabel(kind: unknown): string {
  if (kind === "email" || kind === "call" || kind === "meeting" || kind === "dnc") {
    return TASK_KIND_LABELS[kind];
  }
  return "task";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function describeTaskActivity(
  payload: Record<string, unknown>,
): string | null {
  const what = typeof payload.what === "string" ? payload.what : "";
  const after = asRecord(payload.after);

  if (what === "task.complete") {
    const kindLabel = taskKindLabel(after?.kind);
    const status = typeof after?.status === "string" ? after.status : "done";
    const next = asRecord(after?.next);
    if (next) {
      return `Completed ${kindLabel} (${status}) · saved follow-up ${taskKindLabel(next.kind)}`;
    }
    return `Completed ${kindLabel} (${status})`;
  }

  if (what === "task.create") {
    const kindLabel = taskKindLabel(after?.kind);
    if (after && typeof after.followUpFromTaskId === "string") {
      return `Saved follow-up ${kindLabel}`;
    }
    return `Created ${kindLabel} task`;
  }

  if (what === "task.delete") {
    const before = asRecord(payload.before);
    return `Removed ${taskKindLabel(before?.kind)} task`;
  }

  if (what === "task.notes") {
    return "Updated task notes";
  }

  if (what === "task.update") {
    const before = asRecord(payload.before);
    const kindLabel = taskKindLabel(after?.kind ?? before?.kind);
    const changes: string[] = [];
    if (before?.kind !== after?.kind) {
      changes.push("type");
    }
    if (before?.dueAt !== after?.dueAt) {
      changes.push("due date");
    }
    if (before?.notes !== after?.notes) {
      changes.push("notes");
    }
    if (changes.length === 0) {
      return `Updated ${kindLabel} task`;
    }
    return `Updated ${kindLabel} ${joinList(changes)}`;
  }

  return null;
}

function joinList(items: string[]): string {
  if (items.length === 1) {
    return items[0] ?? "";
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function completedTaskIdFromPayload(
  payload: Record<string, unknown>,
): string | null {
  if (payload.what !== "task.complete") {
    return null;
  }
  const after = asRecord(payload.after);
  return typeof after?.taskId === "string" ? after.taskId : null;
}

export function isFollowUpTask(
  task: { id: string; kind: string; dueAt: string },
  payloads: Record<string, unknown>[],
): boolean {
  for (const payload of payloads) {
    if (payload.what !== "task.create") {
      continue;
    }
    const after = asRecord(payload.after);
    if (!after || typeof after.followUpFromTaskId !== "string") {
      continue;
    }
    if (after.taskId === task.id) {
      return true;
    }
    if (after.kind === task.kind && after.dueAt === task.dueAt) {
      return true;
    }
  }
  return false;
}

export type OpenTaskGuide = "leftover" | "overdue" | "follow-up" | "todo";

export function classifyOpenTask(input: {
  id: string;
  kind: string;
  dueAt: string;
  nowMs: number;
  payloads: Record<string, unknown>[];
}): OpenTaskGuide {
  if (input.payloads.some((payload) => completedTaskIdFromPayload(payload) === input.id)) {
    return "leftover";
  }
  if (isFollowUpTask(input, input.payloads)) {
    return "follow-up";
  }
  if (new Date(input.dueAt).getTime() < input.nowMs) {
    return "overdue";
  }
  return "todo";
}
