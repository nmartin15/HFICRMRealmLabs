"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CreatePersonBody,
  CreatePersonResponse,
  PersonSource,
  TaskKind,
} from "@realm-labs/contracts";
import { TASK_KIND_LABELS } from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { fromDatetimeLocalValue, todayTaskDueLocal } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SOURCES: PersonSource[] = ["linkedin", "workable", "referral", "other"];
const TASK_KINDS: TaskKind[] = ["email", "call", "meeting", "dnc"];
const RESUME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function allowedResume(file: File): boolean {
  if (RESUME_TYPES.has(file.type)) {
    return true;
  }
  return /\.(pdf|docx?)$/i.test(file.name);
}

export function ContactDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: CreatePersonResponse) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const resumeRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [source, setSource] = useState<PersonSource>("other");
  const [notes, setNotes] = useState("");
  const [firstTaskKind, setFirstTaskKind] = useState<TaskKind | "">("");
  const [firstTaskDue, setFirstTaskDue] = useState(todayTaskDueLocal);
  const [firstTaskNotes, setFirstTaskNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    if (open && !node.open) {
      setName("");
      setEmail("");
      setTitle("");
      setCompany("");
      setLocation("");
      setSource("other");
      setNotes("");
      setFirstTaskKind("");
      setFirstTaskDue(todayTaskDueLocal());
      setFirstTaskNotes("");
      setError("");
      if (resumeRef.current) {
        resumeRef.current.value = "";
      }
      node.showModal();
      queueMicrotask(() => nameRef.current?.focus());
    }
    if (!open && node.open) {
      node.close();
    }
  }, [open]);

  async function submit() {
    setError("");
    if (firstTaskKind && !firstTaskDue) {
      setError("Follow-up due date is required");
      return;
    }
    const resume = resumeRef.current?.files?.[0];
    if (resume && !allowedResume(resume)) {
      setError("Attach a PDF or Word document");
      return;
    }
    setSaving(true);
    const body: CreatePersonBody = {
      name: name.trim(),
      email: email.trim(),
      source,
    };
    if (title.trim()) {
      body.title = title.trim();
    }
    if (company.trim()) {
      body.company = company.trim();
    }
    if (location.trim()) {
      body.location = location.trim();
    }
    if (notes.trim()) {
      body.notes = notes.trim();
    }
    if (firstTaskKind) {
      body.firstTask = {
        kind: firstTaskKind,
        dueAt: fromDatetimeLocalValue(firstTaskDue),
        ...(firstTaskNotes.trim() ? { notes: firstTaskNotes.trim() } : {}),
      };
    }

    try {
      const created = await api<CreatePersonResponse>("/people", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (resume) {
        try {
          const data = new FormData();
          data.append("file", resume);
          await api(`/people/${created.personId}/resume`, {
            method: "POST",
            body: data,
          });
        } catch {
          // Contact exists; resume can be attached on the record.
        }
      }
      await onCreated(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create contact");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="m-auto w-full max-w-md rounded-lg border bg-background p-4 text-foreground shadow-lg"
      onClose={onClose}
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-sm font-medium">Add contact</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Program track can wait. Resume and a follow-up are optional.
        </p>

        <div className="mt-3 grid gap-3">
          <div className="space-y-1">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              ref={nameRef}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact-title">Title</Label>
            <Input
              id="contact-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact-company">Company</Label>
            <Input
              id="contact-company"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact-location">Location</Label>
            <Input
              id="contact-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact-source">Source</Label>
            <select
              id="contact-source"
              className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
              value={source}
              onChange={(event) =>
                setSource(event.target.value as PersonSource)
              }
            >
              {SOURCES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact-notes">Notes</Label>
            <textarea
              id="contact-notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact-resume">Resume</Label>
            <Input
              id="contact-resume"
              ref={resumeRef}
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="contact-task-kind">Follow-up</Label>
              <select
                id="contact-task-kind"
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
                value={firstTaskKind}
                onChange={(event) =>
                  setFirstTaskKind(event.target.value as TaskKind | "")
                }
              >
                <option value="">None</option>
                {TASK_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {TASK_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </div>
            {firstTaskKind ? (
              <div className="space-y-1">
                <Label htmlFor="contact-task-due">Due</Label>
                <Input
                  id="contact-task-due"
                  type="datetime-local"
                  required
                  value={firstTaskDue}
                  onChange={(event) => setFirstTaskDue(event.target.value)}
                />
              </div>
            ) : null}
            {firstTaskKind === "dnc" ? (
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="contact-task-notes">DNC reason</Label>
                <Input
                  id="contact-task-notes"
                  required
                  value={firstTaskNotes}
                  onChange={(event) => setFirstTaskNotes(event.target.value)}
                />
              </div>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-destructive">{error}</p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Create"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
