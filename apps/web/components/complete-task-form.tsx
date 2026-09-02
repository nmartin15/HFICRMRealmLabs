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
  onCancel,
  onSubmit,
}: {
  task: Pick<Task, "id" | "kind" | "notes">;
  onCancel: () => void;
  onSubmit: (body: CompleteTaskBody) => void;
}) {
  const isDnc = task.kind === "dnc";
  const isMeeting = task.kind === "meeting";
  const [notes, setNotes] = useState(task.notes ?? "");
  const [outcome, setOutcome] = useState<(typeof HAND_SET_MEETING_OUTCOMES)[number]>(
    "held",
  );
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
        if (isMeeting) {
          body.outcome = outcome;
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
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Complete
        </Button>
      </div>
    </form>
  );
}
