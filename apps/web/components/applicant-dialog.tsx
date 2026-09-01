"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CreateAllocationApplicantBody,
  CreateApplicantResponse,
  CreateIncubatorApplicantBody,
  PersonSource,
  ProgramTrack,
} from "@realm-labs/contracts";
import {
  PROGRAM_TRACK_LABELS,
  todayIsoInDisplayZone,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SOURCES: PersonSource[] = ["linkedin", "workable", "referral", "other"];
const TRACKS: ProgramTrack[] = [
  "allocation",
  "incubator",
  "recruitment",
  "capital_raising",
];

export function ApplicantDialog({
  open,
  pipeline,
  onClose,
  onCreated,
}: {
  open: boolean;
  pipeline: "allocation" | "incubator";
  onClose: () => void;
  onCreated: (created: CreateApplicantResponse) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [source, setSource] = useState<PersonSource>("other");
  const [programTrack, setProgramTrack] = useState<ProgramTrack>(pipeline);
  const [appliedAt, setAppliedAt] = useState(
    todayIsoInDisplayZone(new Date()),
  );
  const [applicationRef, setApplicationRef] = useState("");
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
      setProgramTrack(pipeline);
      setAppliedAt(todayIsoInDisplayZone(new Date()));
      setApplicationRef("");
      setError("");
      node.showModal();
      queueMicrotask(() => nameRef.current?.focus());
    }
    if (!open && node.open) {
      node.close();
    }
  }, [open, pipeline]);

  async function submit() {
    setError("");
    setSaving(true);
    const shared: CreateAllocationApplicantBody = {
      name: name.trim(),
      email: email.trim(),
      source,
      programTrack,
    };
    if (title.trim()) {
      shared.title = title.trim();
    }
    if (company.trim()) {
      shared.company = company.trim();
    }
    if (location.trim()) {
      shared.location = location.trim();
    }
    if (appliedAt) {
      shared.appliedAt = appliedAt;
    }

    const body: CreateAllocationApplicantBody | CreateIncubatorApplicantBody =
      programTrack === "incubator"
        ? {
            ...shared,
            ...(applicationRef.trim()
              ? { applicationRef: applicationRef.trim() }
              : {}),
          }
        : shared;

    try {
      const created = await api<CreateApplicantResponse>(
        programTrack === "incubator" ? "/incubator" : "/allocation",
        { method: "POST", body: JSON.stringify(body) },
      );
      await onCreated(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create applicant");
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
        <h2 className="text-sm font-medium">New contact</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Program track puts the card on a board.
        </p>

        <div className="mt-3 grid gap-3">
          <div className="space-y-1">
            <Label htmlFor="applicant-name">Name</Label>
            <Input
              id="applicant-name"
              ref={nameRef}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="applicant-email">Email</Label>
            <Input
              id="applicant-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="applicant-track">Program track</Label>
            <select
              id="applicant-track"
              required
              className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
              value={programTrack}
              onChange={(event) =>
                setProgramTrack(event.target.value as ProgramTrack)
              }
            >
              {TRACKS.map((value) => (
                <option key={value} value={value}>
                  {PROGRAM_TRACK_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="applicant-title">Title</Label>
            <Input
              id="applicant-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="applicant-company">Company</Label>
            <Input
              id="applicant-company"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="applicant-location">Location</Label>
            <Input
              id="applicant-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="applicant-source">Source</Label>
            <select
              id="applicant-source"
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
            <Label htmlFor="applicant-applied">Applied</Label>
            <Input
              id="applicant-applied"
              type="date"
              required
              value={appliedAt}
              onChange={(event) => setAppliedAt(event.target.value)}
            />
          </div>
          {programTrack === "incubator" ? (
            <div className="space-y-1">
              <Label htmlFor="applicant-ref">Application ref</Label>
              <Input
                id="applicant-ref"
                value={applicationRef}
                onChange={(event) => setApplicationRef(event.target.value)}
              />
            </div>
          ) : null}
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
