"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type {
  CompleteTaskBody,
  EmailMessageDirection,
  Person,
  PersonDetailResponse,
  PersonPatch,
  ProgramTrack,
  Task,
  TaskKind,
  TimelineItem,
  User,
  UserListResponse,
} from "@realm-labs/contracts";
import {
  ALLOCATION_STAGE_LABELS,
  BUDGET_QUALIFIED_LABELS,
  INCUBATOR_STAGE_LABELS,
  LEAD_TEMP_LABELS,
  PROGRAM_TRACK_LABELS,
  TASK_KIND_LABELS,
  classifyOpenTask,
  completedTaskIdFromPayload,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { activityActorLabel, activitySummary } from "@/lib/activity-summary";
import {
  defaultTaskDueLocal,
  formatDate,
  formatDateTime,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/lib/format";
import { isTypingTarget, useListNavigation } from "@/hooks/use-list-navigation";
import { CompleteTaskForm } from "@/components/complete-task-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<Person["source"], string> = {
  linkedin: "LinkedIn",
  workable: "Workable",
  referral: "Referral",
  other: "Other",
  website: "Website",
};

const DIRECTION_LABEL: Record<EmailMessageDirection, string> = {
  inbound: "In",
  outbound: "Out",
  other: "Other",
};
const TASK_KINDS: TaskKind[] = ["email", "call", "meeting", "dnc"];
const TRACKS: ProgramTrack[] = [
  "allocation",
  "incubator",
  "recruitment",
  "capital_raising",
];
const RESUME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function boardLabel(board: NonNullable<PersonDetailResponse["board"]>): string {
  if (board.board === "incubator") {
    return `Incubator · ${INCUBATOR_STAGE_LABELS[board.stage]}`;
  }
  return `${PROGRAM_TRACK_LABELS[board.board]} · ${ALLOCATION_STAGE_LABELS[board.stage]}`;
}

function resumeHref(url: string | null): string | null {
  if (!url) {
    return null;
  }
  if (url.startsWith("https://") || url.startsWith("http://")) {
    return url;
  }
  return `/api${url}`;
}

function allowedResume(file: File): boolean {
  if (RESUME_TYPES.has(file.type)) {
    return true;
  }
  return /\.(pdf|docx?)$/i.test(file.name);
}

function taskOwnerLabel(operators: User[], createdBy: string): string {
  return operators.find((row) => row.id === createdBy)?.name ?? "";
}

export default function PersonRecordPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<PersonDetailResponse | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [taskKind, setTaskKind] = useState<TaskKind>("email");
  const [taskDue, setTaskDue] = useState(defaultTaskDueLocal);
  const [taskNotes, setTaskNotes] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [draftTaskKind, setDraftTaskKind] = useState<TaskKind>("email");
  const [draftTaskDue, setDraftTaskDue] = useState(defaultTaskDueLocal);
  const [draftTaskNotes, setDraftTaskNotes] = useState("");
  const [personNotes, setPersonNotes] = useState("");
  const [saveHint, setSaveHint] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [personRes, userRes] = await Promise.all([
      api<PersonDetailResponse>(`/people/${id}`),
      api<UserListResponse>("/users"),
    ]);
    setDetail(personRes);
    setPersonNotes(personRes.person.notes ?? "");
    setUsers(userRes.data);
    return personRes;
  }, [id]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load person");
    });
  }, [load]);

  const timeline = detail?.timeline ?? [];
  const selected = useListNavigation(timeline.length);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.key === "Escape") {
        if (expandedThreadId) {
          event.preventDefault();
          setExpandedThreadId(null);
        }
        return;
      }
      if (event.key !== "Enter") {
        return;
      }
      const item = timeline[selected];
      if (!item || item.kind !== "email") {
        return;
      }
      event.preventDefault();
      setExpandedThreadId((current) =>
        current === item.thread.id ? null : item.thread.id,
      );
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedThreadId, selected, timeline]);

  async function patch(body: PersonPatch) {
    setError("");
    try {
      const person = await api<Person>(`/people/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setDetail((current) => (current ? { ...current, person } : current));
      if (body.notes !== undefined) {
        setPersonNotes(person.notes ?? "");
      }
      setSaveHint("Saved");
      window.setTimeout(() => setSaveHint(""), 1500);
      if (body.programTrack !== undefined) {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function createTask() {
    setError("");
    try {
      await api<Task>(`/people/${id}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          kind: taskKind,
          dueAt: fromDatetimeLocalValue(taskDue),
          ...(taskNotes.trim() ? { notes: taskNotes.trim() } : {}),
        }),
      });
      setTaskNotes("");
      setTaskKind("email");
      setTaskDue(defaultTaskDueLocal());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    }
  }

  async function saveTask(taskId: string) {
    setError("");
    try {
      await api<Task>(`/people/${id}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({
          kind: draftTaskKind,
          dueAt: fromDatetimeLocalValue(draftTaskDue),
          notes: draftTaskNotes.trim() ? draftTaskNotes.trim() : null,
        }),
      });
      setSaveHint("Task saved");
      window.setTimeout(() => setSaveHint(""), 1500);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save task");
    }
  }

  async function completeTask(taskId: string, body: CompleteTaskBody) {
    setError("");
    try {
      await api<Task>(`/people/${id}/tasks/${taskId}/complete`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setCompletingId(null);
      const nextDetail = await load();
      if (body.next && body.next.kind !== "dnc") {
        const followUp = [...nextDetail.tasks]
          .filter((task) => task.status === "open")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (followUp) {
          openTask(followUp);
        }
      } else {
        setExpandedTaskId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete task");
    }
  }

  async function deleteTask(taskId: string) {
    setError("");
    try {
      await api(`/people/${id}/tasks/${taskId}`, { method: "DELETE" });
      setRemovingId(null);
      setCompletingId(null);
      setExpandedTaskId(null);
      setSaveHint("Task removed");
      window.setTimeout(() => setSaveHint(""), 1500);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove task");
    }
  }

  function openTask(task: Task) {
    setExpandedTaskId(task.id);
    setDraftTaskKind(task.kind);
    setDraftTaskDue(toDatetimeLocalValue(task.dueAt));
    setDraftTaskNotes(task.notes ?? "");
    setCompletingId(null);
  }

  async function onResumeFile(file: File | undefined) {
    if (!file) {
      return;
    }
    if (!allowedResume(file)) {
      setError("Attach a PDF or Word document");
      return;
    }
    setError("");
    try {
      const data = new FormData();
      data.append("file", file);
      const person = await api<Person>(`/people/${id}/resume`, {
        method: "POST",
        body: data,
      });
      setDetail((current) => (current ? { ...current, person } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload resume");
    }
  }

  if (!detail && !error) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!detail) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  const person = detail.person;
  const name = `${person.firstName} ${person.lastName}`;
  const activityPayloads = timeline
    .filter(
      (item): item is Extract<TimelineItem, { kind: "activity" }> =>
        item.kind === "activity",
    )
    .map((item) => item.activity.payload);
  const nowMs = Date.now();
  const openTasks = detail.tasks.filter((task) => {
    if (task.status !== "open") {
      return false;
    }
    return (
      classifyOpenTask({
        id: task.id,
        kind: task.kind,
        dueAt: task.dueAt,
        nowMs,
        payloads: activityPayloads,
      }) !== "leftover"
    );
  });
  const closedTasks = detail.tasks.filter((task) => {
    if (task.status !== "open") {
      return true;
    }
    return (
      classifyOpenTask({
        id: task.id,
        kind: task.kind,
        dueAt: task.dueAt,
        nowMs,
        payloads: activityPayloads,
      }) === "leftover"
    );
  });

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-medium tracking-tight">{name}</h1>
            <p className="text-sm text-muted-foreground">
              {[person.title, person.company, person.location]
                .filter(Boolean)
                .join(" · ") || "No title, company, or location"}
            </p>
          </div>
          {detail.board ? (
            <Link
              href={detail.board.href}
              className="rounded-full border px-2.5 py-1 text-xs"
            >
              {boardLabel(detail.board)}
            </Link>
          ) : null}
        </div>
        {person.doNotContact ? (
          <p className="rounded-md bg-red-600 px-3 py-2 text-sm text-white">
            Do not contact
          </p>
        ) : null}
        {person.needsReview ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <p>Needs review</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void patch({ needsReview: false })}
            >
              Mark reviewed
            </Button>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          No Save button — fields save when you leave them
          {saveHint ? ` · ${saveHint}` : ""}.
        </p>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">First name</dt>
            <dd>
              <Input
                value={person.firstName}
                onChange={(event) =>
                  setDetail((current) =>
                    current
                      ? {
                          ...current,
                          person: {
                            ...current.person,
                            firstName: event.target.value,
                          },
                        }
                      : current,
                  )
                }
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value) {
                    void patch({ firstName: value });
                  }
                }}
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last name</dt>
            <dd>
              <Input
                value={person.lastName}
                onChange={(event) =>
                  setDetail((current) =>
                    current
                      ? {
                          ...current,
                          person: {
                            ...current.person,
                            lastName: event.target.value,
                          },
                        }
                      : current,
                  )
                }
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value) {
                    void patch({ lastName: value });
                  }
                }}
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd>
              <a
                className="underline-offset-2 hover:underline"
                href={`mailto:${person.email}`}
              >
                {person.email}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Source</dt>
            <dd>{SOURCE_LABEL[person.source]}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Resume</dt>
            <dd className="space-y-1">
              {person.resumeFilename ? (
                <p>{person.resumeFilename}</p>
              ) : null}
              {resumeHref(person.resumeUrl) ? (
                <a
                  href={resumeHref(person.resumeUrl) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  Open resume
                </a>
              ) : null}
              {!person.resumeFilename && !person.resumeUrl ? "—" : null}
              <Input
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) =>
                  void onResumeFile(event.target.files?.[0])
                }
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Applied</dt>
            <dd>{person.appliedAt ? formatDate(person.appliedAt) : "—"}</dd>
          </div>
        </dl>
      </header>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <section className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="programTrack">Program track</Label>
          <select
            id="programTrack"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            value={person.programTrack ?? ""}
            disabled={person.doNotContact}
            onChange={(event) => {
              const value = event.target.value;
              if (!value) {
                return;
              }
              void patch({ programTrack: value as ProgramTrack });
            }}
          >
            {!person.programTrack ? <option value="">Select…</option> : null}
            {TRACKS.map((track) => (
              <option key={track} value={track}>
                {PROGRAM_TRACK_LABELS[track]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="leadTemp">Lead temp</Label>
          <select
            id="leadTemp"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            value={person.leadTemp ?? ""}
            onChange={(event) =>
              void patch({
                leadTemp: event.target.value
                  ? (event.target.value as NonNullable<Person["leadTemp"]>)
                  : null,
              })
            }
          >
            <option value="">—</option>
            {(Object.keys(LEAD_TEMP_LABELS) as Person["leadTemp"][]).map(
              (value) =>
                value ? (
                  <option key={value} value={value}>
                    {LEAD_TEMP_LABELS[value]}
                  </option>
                ) : null,
            )}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="budgetQualified">Budget qualified</Label>
          <select
            id="budgetQualified"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            value={person.budgetQualified}
            onChange={(event) =>
              void patch({
                budgetQualified: event.target.value as Person["budgetQualified"],
              })
            }
          >
            {(
              Object.keys(BUDGET_QUALIFIED_LABELS) as Person["budgetQualified"][]
            ).map((value) => (
              <option key={value} value={value}>
                {BUDGET_QUALIFIED_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="doNotContact"
            type="checkbox"
            checked={person.doNotContact}
            onChange={(event) =>
              void patch({ doNotContact: event.target.checked })
            }
          />
          <Label htmlFor="doNotContact">Do not contact</Label>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="owner">Owner</Label>
          <select
            id="owner"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            value={person.ownerId ?? ""}
            onChange={(event) =>
              void patch({
                ownerId: event.target.value ? event.target.value : null,
              })
            }
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="person-notes">Notes</Label>
          <textarea
            id="person-notes"
            rows={3}
            value={personNotes}
            onChange={(event) => setPersonNotes(event.target.value)}
            onBlur={() => {
              const next = personNotes.trim() ? personNotes.trim() : null;
              if (next !== (person.notes ?? null)) {
                void patch({ notes: next });
              }
            }}
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Tasks</h2>
        <p className="text-xs text-muted-foreground">
          Both operators see every task on this contact. Home stays mine-only.
          Type, due date, and notes stay editable after save. Each change
          is recorded on the timeline.
          I finished this closes it after you actually did the work.
          A next follow-up is asked only when this is the last open task.
          {saveHint ? ` · ${saveHint}` : ""}
        </p>
        {openTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open tasks.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {openTasks.map((task) => {
              const guide = classifyOpenTask({
                id: task.id,
                kind: task.kind,
                dueAt: task.dueAt,
                nowMs,
                payloads: activityPayloads,
              });
              const copy = taskGuideCopy(guide, TASK_KIND_LABELS[task.kind], task);
              const otherOpen = openTasks.filter((row) => row.id !== task.id).length;
              const owner = taskOwnerLabel(users, task.createdBy);
              return (
              <li key={task.id} className="space-y-2 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      if (completingId === task.id) {
                        return;
                      }
                      expandedTaskId === task.id
                        ? setExpandedTaskId(null)
                        : openTask(task);
                    }}
                  >
                    <p>
                      <span className="mr-2 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {copy.badge}
                      </span>
                      {TASK_KIND_LABELS[task.kind]} · due{" "}
                      {formatDateTime(task.dueAt)}
                      {owner ? ` · ${owner}` : ""}
                    </p>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {copy.hint}
                    </span>
                    {task.notes ? (
                      <span className="mt-0.5 block text-muted-foreground">
                        {task.notes}
                      </span>
                    ) : null}
                  </button>
                  {completingId === task.id ? null : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        expandedTaskId === task.id && completingId !== task.id
                          ? "default"
                          : "outline"
                      }
                      onClick={() =>
                        expandedTaskId === task.id && completingId !== task.id
                          ? setExpandedTaskId(null)
                          : openTask(task)
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRemovingId(null);
                        openTask(task);
                        setCompletingId(task.id);
                      }}
                    >
                      I finished this
                    </Button>
                    {removingId === task.id ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void deleteTask(task.id)}
                        >
                          Confirm remove
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setRemovingId(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setRemovingId(task.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  )}
                </div>
                {expandedTaskId === task.id && completingId !== task.id ? (
                  <TaskEditFields
                    taskId={task.id}
                    kind={draftTaskKind}
                    due={draftTaskDue}
                    notes={draftTaskNotes}
                    onKind={setDraftTaskKind}
                    onDue={setDraftTaskDue}
                    onNotes={setDraftTaskNotes}
                    onSave={() => void saveTask(task.id)}
                    onClose={() => setExpandedTaskId(null)}
                  />
                ) : null}
                {completingId === task.id ? (
                  <CompleteTaskForm
                    task={task}
                    requireFollowUp={otherOpen === 0}
                    guide={guide === "overdue" || guide === "follow-up" ? guide : "todo"}
                    onCancel={() => setCompletingId(null)}
                    onSubmit={(body) => void completeTask(task.id, body)}
                  />
                ) : null}
              </li>
              );
            })}
          </ul>
        )}

        <form
          className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void createTask();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="task-kind">Type</Label>
            <select
              id="task-kind"
              className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
              value={taskKind}
              onChange={(event) => setTaskKind(event.target.value as TaskKind)}
            >
              {TASK_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {TASK_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="task-due">Due</Label>
            <Input
              id="task-due"
              type="datetime-local"
              required
              value={taskDue}
              onChange={(event) => setTaskDue(event.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="task-notes">Notes</Label>
            <textarea
              id="task-notes"
              rows={2}
              required={taskKind === "dnc"}
              value={taskNotes}
              onChange={(event) => setTaskNotes(event.target.value)}
              placeholder={
                taskKind === "dnc"
                  ? "DNC reason (required) — closes immediately"
                  : "Optional context for this open task"
              }
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm">
              Add task
            </Button>
          </div>
        </form>

        {closedTasks.length > 0 ? (
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 text-sm">
              Closed tasks ({closedTasks.length})
            </summary>
            <ul className="divide-y border-t">
              {closedTasks.map((task) => {
                const audit = completionAudit(task.id, timeline, users);
                const owner = taskOwnerLabel(users, task.createdBy);
                return (
                <li key={task.id} className="space-y-2 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                  {TASK_KIND_LABELS[task.kind]} · {task.status} · due{" "}
                  {formatDateTime(task.dueAt)}
                  {owner ? ` · ${owner}` : ""}
                  {audit ? (
                    <span className="block text-xs text-muted-foreground">
                      Completed {formatDateTime(audit.when)} · {audit.who}
                    </span>
                  ) : (
                    <span className="block text-xs text-muted-foreground">
                      Closed {formatDateTime(task.updatedAt)}
                    </span>
                  )}
                  {task.notes ? (
                    <span className="block text-muted-foreground">
                      {task.notes}
                    </span>
                  ) : null}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          expandedTaskId === task.id ? "default" : "outline"
                        }
                        onClick={() =>
                          expandedTaskId === task.id
                            ? setExpandedTaskId(null)
                            : openTask(task)
                        }
                      >
                        Edit
                      </Button>
                      <CompletedInErrorControl
                        confirm={removingId === task.id}
                        onAsk={() => setRemovingId(task.id)}
                        onCancel={() => setRemovingId(null)}
                        onConfirm={() => void deleteTask(task.id)}
                      />
                    </div>
                  </div>
                  {expandedTaskId === task.id ? (
                    <TaskEditFields
                      taskId={task.id}
                      kind={draftTaskKind}
                      due={draftTaskDue}
                      notes={draftTaskNotes}
                      onKind={setDraftTaskKind}
                      onDue={setDraftTaskDue}
                      onNotes={setDraftTaskNotes}
                      onSave={() => void saveTask(task.id)}
                      onClose={() => setExpandedTaskId(null)}
                    />
                  ) : null}
                </li>
                );
              })}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Timeline</h2>
        <p className="text-xs text-muted-foreground">
          j/k to move, enter to expand email, esc to collapse.
        </p>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {timeline.map((item, index) => (
              <TimelineRow
                key={`${item.kind}-${item.occurredAt}-${index}`}
                item={item}
                index={index}
                active={index === selected}
                expanded={
                  item.kind === "email" && expandedThreadId === item.thread.id
                }
                users={users}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function TaskEditFields({
  taskId,
  kind,
  due,
  notes,
  onKind,
  onDue,
  onNotes,
  onSave,
  onClose,
}: {
  taskId: string;
  kind: TaskKind;
  due: string;
  notes: string;
  onKind: (kind: TaskKind) => void;
  onDue: (due: string) => void;
  onNotes: (notes: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2">
      <p className="text-xs text-muted-foreground">
        Fix type, due date, or notes. The timeline keeps a record of the
        change.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`edit-kind-${taskId}`}>Type</Label>
          <select
            id={`edit-kind-${taskId}`}
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            value={kind}
            onChange={(event) => onKind(event.target.value as TaskKind)}
          >
            {TASK_KINDS.map((value) => (
              <option key={value} value={value}>
                {TASK_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`edit-due-${taskId}`}>Due</Label>
          <Input
            id={`edit-due-${taskId}`}
            type="datetime-local"
            required
            value={due}
            onChange={(event) => onDue(event.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`edit-notes-${taskId}`}>Notes</Label>
          <textarea
            id={`edit-notes-${taskId}`}
            rows={3}
            required={kind === "dnc"}
            value={notes}
            onChange={(event) => onNotes(event.target.value)}
            placeholder={
              kind === "dnc"
                ? "DNC reason (required)"
                : "Talking points, email draft context, call agenda…"
            }
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onSave}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function CompletedInErrorControl({
  confirm,
  onAsk,
  onCancel,
  onConfirm,
}: {
  confirm: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (confirm) {
    return (
      <p className="max-w-[12rem] text-right text-[11px] leading-snug text-muted-foreground">
        Completed in error?
        <button
          type="button"
          className="ml-1 underline hover:text-foreground"
          onClick={onConfirm}
        >
          Remove it
        </button>
        <button
          type="button"
          className="ml-1 hover:text-foreground"
          onClick={onCancel}
        >
          Keep
        </button>
      </p>
    );
  }
  return (
    <button
      type="button"
      className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
      onClick={onAsk}
    >
      Completed in error
    </button>
  );
}

function taskGuideCopy(
  guide: ReturnType<typeof classifyOpenTask>,
  kindLabel: string,
  task: Task,
): { badge: string; hint: string } {
  const due = formatDateTime(task.dueAt);
  const saved = formatDateTime(task.createdAt);
  if (guide === "leftover") {
    return {
      badge: "Already logged",
      hint: `This ${kindLabel.toLowerCase()} is already on the timeline as completed. It is not actionable.`,
    };
  }
  if (guide === "overdue") {
    return {
      badge: "Overdue",
      hint: `Due ${due} has passed. Use I finished this only if you already did this ${kindLabel.toLowerCase()}.`,
    };
  }
  if (guide === "follow-up") {
    return {
      badge: "Follow-up",
      hint: `Next step · due ${due} · saved ${saved}. Edit if the date or type is wrong. I finished this only after you do the work.`,
    };
  }
  return {
    badge: "To do",
      hint: `Due ${due} · saved ${saved}. Edit if the date or type is wrong. I finished this closes it after you do the work.`,
  };
}

function completionAudit(
  taskId: string,
  timeline: TimelineItem[],
  users: User[],
): { when: string; who: string } | null {
  for (const item of timeline) {
    if (item.kind !== "activity") {
      continue;
    }
    if (completedTaskIdFromPayload(item.activity.payload) !== taskId) {
      continue;
    }
    return {
      when: item.occurredAt,
      who: activityActorLabel(item.activity, users),
    };
  }
  return null;
}

function TimelineRow({
  item,
  index,
  active,
  expanded,
  users,
}: {
  item: TimelineItem;
  index: number;
  active: boolean;
  expanded: boolean;
  users: User[];
}) {
  return (
    <li
      data-nav-index={index}
      className={cn("px-3 py-2 text-sm", active && "bg-primary/10")}
    >
      <p className="text-xs text-muted-foreground">
        {formatDateTime(item.occurredAt)}
        {item.kind === "activity"
          ? ` · ${activityActorLabel(item.activity, users)}`
          : ""}
      </p>
      {item.kind === "activity" ? (
        <p>{activitySummary(item.activity)}</p>
      ) : null}
      {item.kind === "email" ? (
        <div>
          <p>
            Email · {item.thread.subject}
            {item.thread.snippet && !expanded ? (
              <span className="block text-muted-foreground">
                {item.thread.snippet}
              </span>
            ) : null}
          </p>
          {expanded ? (
            <ol className="mt-2 space-y-3 border-l pl-3">
              {item.thread.messages.length === 0 ? (
                <li className="text-xs text-muted-foreground">
                  No messages synced yet.
                </li>
              ) : (
                item.thread.messages.map((message) => (
                  <li key={message.id} className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {DIRECTION_LABEL[message.direction]} ·{" "}
                      {formatDateTime(message.sentAt)}
                    </p>
                    <p className="text-xs">
                      From {message.fromEmail || "(unknown)"}
                      {message.toEmails.length > 0
                        ? ` → ${message.toEmails.join(", ")}`
                        : ""}
                    </p>
                    {message.bodyText ? (
                      <pre className="overflow-x-auto whitespace-pre-wrap font-sans text-sm text-foreground">
                        {message.bodyText}
                      </pre>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        (no text body)
                      </p>
                    )}
                  </li>
                ))
              )}
            </ol>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
