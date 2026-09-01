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
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { activitySummary } from "@/lib/activity-summary";
import {
  defaultTaskDueLocal,
  formatDate,
  formatDateTime,
  fromDatetimeLocalValue,
} from "@/lib/format";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { MeetingOutcomeButtons } from "@/components/meeting-outcome-buttons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<Person["source"], string> = {
  linkedin: "LinkedIn",
  workable: "Workable",
  referral: "Referral",
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
  if (board.board === "allocation") {
    return `Allocation · ${ALLOCATION_STAGE_LABELS[board.stage]}`;
  }
  return `Incubator · ${INCUBATOR_STAGE_LABELS[board.stage]}`;
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
  const [completingId, setCompletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [personRes, userRes] = await Promise.all([
      api<PersonDetailResponse>(`/people/${id}`),
      api<UserListResponse>("/users"),
    ]);
    setDetail(personRes);
    setUsers(userRes.data);
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

  async function completeTask(taskId: string, body: CompleteTaskBody) {
    setError("");
    try {
      await api<Task>(`/people/${id}/tasks/${taskId}/complete`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setCompletingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete task");
    }
  }

  async function onResumeFile(file: File | undefined) {
    if (!file) {
      return;
    }
    if (!allowedResume(file)) {
      setError("Attach a PDF or Word document");
      return;
    }
    // TODO: persist the file bytes in blob storage; metadata only for now.
    await patch({
      resumeFilename: file.name,
      resumeContentType: file.type || "application/octet-stream",
    });
  }

  if (!detail && !error) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!detail) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  const person = detail.person;
  const name = `${person.firstName} ${person.lastName}`;
  const openTasks = detail.tasks.filter((task) => task.status === "open");
  const closedTasks = detail.tasks.filter((task) => task.status !== "open");

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
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
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
              {person.resumeUrl ? (
                <a
                  href={person.resumeUrl}
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
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Tasks</h2>
        {openTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open tasks.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {openTasks.map((task) => (
              <li key={task.id} className="space-y-2 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    {TASK_KIND_LABELS[task.kind]} · {formatDateTime(task.dueAt)}
                    {task.notes ? (
                      <span className="block text-muted-foreground">
                        {task.notes}
                      </span>
                    ) : null}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setCompletingId((current) =>
                        current === task.id ? null : task.id,
                      )
                    }
                  >
                    Complete
                  </Button>
                </div>
                {completingId === task.id ? (
                  <CompleteTaskForm
                    task={task}
                    onCancel={() => setCompletingId(null)}
                    onSubmit={(body) => void completeTask(task.id, body)}
                  />
                ) : null}
              </li>
            ))}
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
              {closedTasks.map((task) => (
                <li key={task.id} className="px-3 py-2 text-sm">
                  {TASK_KIND_LABELS[task.kind]} · {task.status} ·{" "}
                  {formatDateTime(task.dueAt)}
                  {task.notes ? (
                    <span className="block text-muted-foreground">
                      {task.notes}
                    </span>
                  ) : null}
                </li>
              ))}
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
                onMeetingUpdated={() => void load()}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function CompleteTaskForm({
  task,
  onCancel,
  onSubmit,
}: {
  task: Task;
  onCancel: () => void;
  onSubmit: (body: CompleteTaskBody) => void;
}) {
  const isDnc = task.kind === "dnc";
  const [notes, setNotes] = useState(task.notes ?? "");
  const [nextKind, setNextKind] = useState<TaskKind>("email");
  const [nextDue, setNextDue] = useState(defaultTaskDueLocal);
  const [nextNotes, setNextNotes] = useState("");

  return (
    <form
      className="grid gap-2 rounded-md border bg-muted/30 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        const body: CompleteTaskBody = {};
        if (notes.trim()) {
          body.notes = notes.trim();
        }
        if (!isDnc) {
          body.next = {
            kind: nextKind,
            dueAt: fromDatetimeLocalValue(nextDue),
            ...(nextNotes.trim() ? { notes: nextNotes.trim() } : {}),
          };
        }
        onSubmit(body);
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`complete-notes-${task.id}`}>Notes</Label>
        <textarea
          id={`complete-notes-${task.id}`}
          rows={2}
          required={isDnc}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      {isDnc ? (
        <p className="text-xs text-muted-foreground">
          DNC does not need a follow-up.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Follow-up task</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`next-kind-${task.id}`}>Type</Label>
              <select
                id={`next-kind-${task.id}`}
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
                value={nextKind}
                onChange={(event) =>
                  setNextKind(event.target.value as TaskKind)
                }
              >
                {TASK_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {TASK_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`next-due-${task.id}`}>Due</Label>
              <Input
                id={`next-due-${task.id}`}
                type="datetime-local"
                required
                value={nextDue}
                onChange={(event) => setNextDue(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`next-notes-${task.id}`}>Follow-up notes</Label>
            <textarea
              id={`next-notes-${task.id}`}
              rows={2}
              required={nextKind === "dnc"}
              value={nextNotes}
              onChange={(event) => setNextNotes(event.target.value)}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Close task
        </Button>
      </div>
    </form>
  );
}

function TimelineRow({
  item,
  active,
  onMeetingUpdated,
}: {
  item: TimelineItem;
  active: boolean;
  onMeetingUpdated: () => void;
}) {
  return (
    <li className={cn("px-3 py-2 text-sm", active && "bg-primary/10")}>
      <p className="text-xs text-muted-foreground">
        {formatDateTime(item.occurredAt)}
      </p>
      {item.kind === "activity" ? (
        <p>
          <span className="text-xs uppercase text-muted-foreground">
            {item.activity.type.replaceAll("_", " ")}
          </span>
          <span className="mx-1">·</span>
          {activitySummary(item.activity)}
        </p>
      ) : null}
      {item.kind === "meeting" ? (
        <div className="space-y-2">
          <p>
            Meeting · {item.meeting.outcome.replaceAll("_", " ")}
            {item.meeting.needsReview ? " · needs review" : ""}
            {item.meeting.notes ? ` · ${item.meeting.notes}` : ""}
          </p>
          {item.meeting.outcome === "scheduled" ? (
            <MeetingOutcomeButtons
              meetingId={item.meeting.id}
              onUpdated={onMeetingUpdated}
            />
          ) : null}
        </div>
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
