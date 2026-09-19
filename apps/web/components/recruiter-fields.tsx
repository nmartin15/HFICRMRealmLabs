"use client";

import { useEffect, useState } from "react";
import type {
  ContactKind,
  Person,
  PersonListResponse,
  PersonSource,
  RecruiterSpecialty,
} from "@realm-labs/contracts";
import {
  CONTACT_KIND_LABELS,
  PERSON_SOURCE_LABELS,
  RECRUITER_SPECIALTY_LABELS,
  personDisplayName,
} from "@realm-labs/contracts";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export const MANUAL_SOURCES: PersonSource[] = [
  "linkedin",
  "workable",
  "referral",
  "other",
  "recruiter",
];

const CONTACT_KINDS: ContactKind[] = ["contact", "recruiter"];
const RECRUITER_SPECIALTIES: RecruiterSpecialty[] = [
  "quant_analyst",
  "quant_developer",
];

export function useRecruiters(open: boolean) {
  const [recruiters, setRecruiters] = useState<Person[]>([]);
  useEffect(() => {
    if (!open) {
      return;
    }
    void api<PersonListResponse>("/people?contactKind=recruiter")
      .then((res) => setRecruiters(res.data))
      .catch(() => setRecruiters([]));
  }, [open]);
  return recruiters;
}

export function ContactKindSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ContactKind;
  onChange: (value: ContactKind) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Type</Label>
      <select
        id={id}
        className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value as ContactKind)}
      >
        {CONTACT_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {CONTACT_KIND_LABELS[kind]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RecruiterSpecialtySelect({
  id,
  value,
  required,
  onChange,
}: {
  id: string;
  value: RecruiterSpecialty | "";
  required?: boolean;
  onChange: (value: RecruiterSpecialty) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Recruiter specialty</Label>
      <select
        id={id}
        required={required}
        className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(event) =>
          onChange(event.target.value as RecruiterSpecialty)
        }
      >
        <option value="">Select specialty</option>
        {RECRUITER_SPECIALTIES.map((specialty) => (
          <option key={specialty} value={specialty}>
            {RECRUITER_SPECIALTY_LABELS[specialty]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SourceSelect({
  id,
  value,
  sources,
  onChange,
}: {
  id: string;
  value: PersonSource;
  sources: PersonSource[];
  onChange: (value: PersonSource) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Source</Label>
      <select
        id={id}
        className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value as PersonSource)}
      >
        {sources.map((source) => (
          <option key={source} value={source}>
            {PERSON_SOURCE_LABELS[source]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RecruiterPicker({
  id,
  value,
  recruiters,
  excludeId,
  required,
  onChange,
}: {
  id: string;
  value: string;
  recruiters: Person[];
  excludeId?: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const options = recruiters.filter((person) => person.id !== excludeId);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Recruiter</Label>
      <select
        id={id}
        required={required}
        className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select recruiter</option>
        {options.map((person) => (
          <option key={person.id} value={person.id}>
            {personDisplayName(person)}
            {person.recruiterSpecialty
              ? ` · ${RECRUITER_SPECIALTY_LABELS[person.recruiterSpecialty]}`
              : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
