import { z } from "zod";
import {
  isoDateTimeSchema,
  taskKindSchema,
  taskStatusSchema,
  uuidSchema,
  type TaskKind,
} from "./enums";

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

export const completeTaskBodySchema = z.object({
  notes: z.string().trim().optional(),
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

export function planCompleteTask(input: {
  currentKind: TaskKind;
  currentStatus: string;
  notes: string | null | undefined;
  next: { kind: TaskKind; dueAt: string; notes?: string } | undefined;
  personDoNotContact: boolean;
  personDeleted: boolean;
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
      next: null,
    };
  }

  if (input.personDoNotContact) {
    return {
      ok: true,
      notes,
      setDoNotContact: false,
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
    next: {
      kind: input.next.kind,
      dueAt: input.next.dueAt,
      notes: nextNotes,
    },
  };
}
