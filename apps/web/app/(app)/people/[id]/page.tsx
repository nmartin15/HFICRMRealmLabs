"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type {
  CompleteTaskBody,
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
} from "@/lib/format";
import { useListNavigation } from "@/hooks/use-list-navigation";
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
  const [draftTaskNotes, setDraftTaskNotes] = useState("");
  const [personNotes, setPersonNotes] = useState("");
  const [saveHint, setSaveHint] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

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

  async function saveTaskNotes(taskId: string) {
    setError("");
    try {
      const task = await api<Task>(`/people/${id}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({
          notes: draftTaskNotes.trim() ? draftTaskNotes.trim() : null,
        }),
      });
      setDetail((current) =>
        current
          ? {
              ...current,
              tasks: current.tasks.map((row) =>
                row.id === task.id ? task : row,
              ),
            }
          : current,
      );
      setSaveHint("Task notes saved");
      window.setTimeout(() => setSaveHint(""), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save task notes");
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
          Save notes keeps a task open (prep for the email or call).
          I finished this closes it after you actually did the work.
          A next follow-up is asked only when this is the last open task.
          Closed tasks are history. The only action is a quiet
          “Completed in error” if you closed the wrong one.
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
                      Add notes
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
                  <div className="space-y-2 rounded-md border bg-muted/30 p-2">
                    <p className="text-xs text-muted-foreground">
                      Save notes keeps this {TASK_KIND_LABELS[task.kind].toLowerCase()}{" "}
                      open. It does not close the task.
                    </p>
                    <Label htmlFor={`task-notes-${task.id}`}>Notes for this task</Label>
                    <textarea
                      id={`task-notes-${task.id}`}
                      rows={3}
                      value={draftTaskNotes}
                      onChange={(event) => setDraftTaskNotes(event.target.value)}
                      placeholder="Talking points, email draft context, call agenda…"
                      className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void saveTaskNotes(task.id)}
                      >
                        Save notes — keep open
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpandedTaskId(null)}
                      >
                        Close
                      </Button>
                    </div>
                  </div>
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
                return (
                <li key={task.id} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                  {TASK_KIND_LABELS[task.kind]} · {task.status} · due{" "}
                  {formatDateTime(task.dueAt)}
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
                    <CompletedInErrorControl
                      confirm={removingId === task.id}
                      onAsk={() => setRemovingId(task.id)}
                      onCancel={() => setRemovingId(null)}
                      onConfirm={() => void deleteTask(task.id)}
                    />
                  </div>
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
          j/k to move, esc to leave a field.
        </p>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {timeline.map((item, index) => (
              <TimelineRow
                key={`${item.kind}-${item.occurredAt}-${index}`}
                item={item}
                active={index === selected}
                users={users}
              />
            ))}
          </ol>
        )}
      </section>
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
      hint: `Next step · due ${due} · saved ${saved}. Add notes to prepare. I finished this only after you do the work.`,
    };
  }
  return {
    badge: "To do",
    hint: `Due ${due} · saved ${saved}. Save notes keeps it open. I finished this closes it after you do the work.`,
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
  active,
  users,
}: {
  item: TimelineItem;
  active: boolean;
  users: User[];
}) {
  return (
    <li className={cn("px-3 py-2 text-sm", active && "bg-primary/10")}>
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
        <p>
          Email · {item.thread.subject}
          {item.thread.snippet ? (
            <span className="block text-muted-foreground">
              {item.thread.snippet}
            </span>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}
