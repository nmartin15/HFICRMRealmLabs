"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CreatePersonResponse,
  Person,
  PersonListResponse,
} from "@realm-labs/contracts";
import {
  PROGRAM_TRACK_LABELS,
  personDisplayName,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import {
  isTypingTarget,
  useListNavigation,
} from "@/hooks/use-list-navigation";
import { ContactDialog } from "@/components/contact-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function matchesQuery(person: Person, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [
    person.firstName,
    person.lastName,
    person.email,
    person.title,
    person.company,
    person.location,
    person.programTrack
      ? PROGRAM_TRACK_LABELS[person.programTrack]
      : "Untracked",
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function trackLabel(person: Person): string {
  if (!person.programTrack) {
    return "Untracked";
  }
  return PROGRAM_TRACK_LABELS[person.programTrack];
}

export default function ContactsPage() {
  const router = useRouter();
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await api<PersonListResponse>("/people");
    setPeople(res.data);
  }, []);

  useEffect(() => {
    void load()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load contacts");
      })
      .finally(() => setLoaded(true));
  }, [load]);

  const rows = useMemo(
    () => people.filter((person) => matchesQuery(person, query.trim())),
    [people, query],
  );
  const selected = useListNavigation(createOpen ? 0 : rows.length);
  const focused = rows[selected];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (createOpen || isTypingTarget(event.target)) {
        return;
      }
      if (event.key === "c") {
        event.preventDefault();
        setCreateOpen(true);
        return;
      }
      if (event.key === "Enter" && focused) {
        event.preventDefault();
        router.push(`/people/${focused.id}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createOpen, focused, router]);

  async function onCreated(created: CreatePersonResponse) {
    router.push(`/people/${created.personId}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            j/k to move, enter to open, c to add. Program track can wait.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          Add contact
        </Button>
      </div>

      <Input
        type="search"
        placeholder="Search name, email, company…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search contacts"
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!loaded ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {people.length === 0
            ? "No contacts yet. Add a contact or import a sheet."
            : "No matches."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((person, index) => (
            <li key={person.id}>
              <button
                type="button"
                data-nav-index={index}
                className={cn(
                  "flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left",
                  index === selected && "bg-primary/10",
                )}
                onClick={() => router.push(`/people/${person.id}`)}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {personDisplayName(person)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {person.email}
                    {person.company ? ` · ${person.company}` : ""}
                    {person.resumeFilename ? " · resume" : ""}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-xs",
                    person.programTrack
                      ? "text-muted-foreground"
                      : "text-canary",
                  )}
                >
                  {trackLabel(person)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ContactDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={onCreated}
      />
    </div>
  );
}
