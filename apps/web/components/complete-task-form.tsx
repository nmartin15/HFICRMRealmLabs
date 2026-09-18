"use client";

import { useState } from "react";
import type { CompleteTaskBody, Task, TaskKind } from "@realm-labs/contracts";
import {
  HAND_SET_MEETING_OUTCOMES,
  TASK_KIND_LABELS,
} from "@realm-labs/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  defaultTaskDueLocal,
  fromDatetimeLocalValue,
} from "@/lib/format";

const TASK_KINDS: TaskKind[] = ["email", "call", "meeting", "dnc"];

const OUTCOME_LABELS: Record<(typeof HAND_SET_MEETING_OUTCOMES)[number], string> = {
  held: "Held",
  no_show: "No Show",
  rescheduled: "Rescheduled",
};

export function CompleteTaskForm({
  task,
  requireFollowUp = false,
  hasExistingFollowUp = false,
  guide = "todo",
  onCancel,
  onSubmit,
}: {
  task: Pick<Task, "id" | "kind" | "notes">;
  requireFollowUp?: boolean;
  hasExistingFollowUp?: boolean;
  guide?: "overdue" | "follow-up" | "todo";
  onCancel: () => void;
  onSubmit: (body: CompleteTaskBody) => void;
}) {
  const isDnc = task.kind === "dnc";
  const isMeeting = task.kind === "meeting";
  const [notes, setNotes] = useState(task.notes ?? "");
  const [outcome, setOutcome] = useState<(typeof HAND_SET_MEETING_OUTCOMES)[number]>(
    "held",
  );
  const [addFollowUp, setAddFollowUp] = useState(
    requireFollowUp && !isDnc && !hasExistingFollowUp,
  );
  const [nextKind, setNextKind] = useState<TaskKind>("email");
  const [nextDue, setNextDue] = useState(defaultTaskDueLocal);
  const [nextNotes, setNextNotes] = useState("");
  const showFollowUp = !isDnc && !hasExistingFollowUp && addFollowUp;

  return (
    <form
      className="grid gap-2 rounded-md border bg-muted/30 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        const body: CompleteTaskBody = {};
        if (notes.trim()) {
          body.notes = notes.trim();
        }
        if (isMeeting) {
          body.outcome = outcome;
        }
        if (showFollowUp) {
          body.next = {
            kind: nextKind,
            dueAt: fromDatetimeLocalValue(nextDue),
            ...(nextNotes.trim() ? { notes: nextNotes.trim() } : {}),
          };
        }
        onSubmit(body);
      }}
    >
      {isMeeting ? (
        <fieldset className="space-y-1">
          <legend className="text-xs text-muted-foreground">Outcome</legend>
          <div className="flex flex-wrap gap-1">
            {HAND_SET_MEETING_OUTCOMES.map((value) => (
              <Button
                key={value}
                type="button"
                size="xs"
                variant={outcome === value ? "default" : "outline"}
                onClick={() => setOutcome(value)}
              >
                {OUTCOME_LABELS[value]}
              </Button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor={`complete-notes-${task.id}`}>Completion notes</Label>
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
      ) : hasExistingFollowUp ? (
        <p className="text-xs text-muted-foreground">
          {isMeeting
            ? "A follow-up is already open. Logging the outcome closes this call and leaves that follow-up."
            : "A follow-up is already open. Closing this leaves that follow-up."}
        </p>
      ) : showFollowUp ? (
        <>
          <p className="text-xs text-muted-foreground">
            {guide === "overdue"
              ? "Due date passed. Closing this records that you finished the work. The follow-up stays open until you do that later work."
              : "Closing this records that you finished the work. The follow-up stays open until you do that later work."}
          </p>
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
            <div className="space-y-1 sm:col-span-2">
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
          </div>
          {requireFollowUp ? null : (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setAddFollowUp(false)}
            >
              Skip follow-up
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {isMeeting
              ? "Logging the outcome closes this call. Add a follow-up only if you still need one."
              : "Closing this records that you finished the work. Add a follow-up only if you still need one."}
          </p>
          <button
            type="button"
            className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setAddFollowUp(true)}
          >
            Add a follow-up
          </button>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          {showFollowUp
            ? "Close this and set the next follow-up"
            : isMeeting
              ? "Log outcome and close"
              : "Close this task"}
        </Button>
      </div>
    </form>
  );
}
