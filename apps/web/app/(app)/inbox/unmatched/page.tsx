"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  EmailThread,
  EmailThreadListResponse,
  Person,
  PersonListResponse,
} from "@realm-labs/contracts";
import { personDisplayName } from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function UnmatchedInboxPage() {
  const router = useRouter();
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [personByThread, setPersonByThread] = useState<Record<string, string>>(
    {},
  );
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [threadRes, peopleRes] = await Promise.all([
      api<EmailThreadListResponse>("/email-threads/unmatched"),
      api<PersonListResponse>("/people"),
    ]);
    setThreads(threadRes.data);
    setPeople(peopleRes.data);
  }, []);

  const linkThread = useCallback(
    async (threadId: string, personId: string) => {
      setError("");
      try {
        await api(`/email-threads/${threadId}`, {
          method: "PATCH",
          body: JSON.stringify({ personId }),
        });
        await load();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to link thread");
      }
    },
    [load, router],
  );

  useEffect(() => {
    void load()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load inbox");
      })
      .finally(() => setLoaded(true));
  }, [load]);

  const selected = useListNavigation(threads.length);
  const focused = threads[selected];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || !focused) {
        return;
      }
      event.preventDefault();
      const personId = personByThread[focused.id];
      if (personId) {
        void linkThread(focused.id, personId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused, linkThread, personByThread]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-medium tracking-tight">Unmatched inbox</h1>
        <p className="text-sm text-muted-foreground">
          Shared mailbox threads with no person match. j/k to move, enter to
          link the selected person.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!loaded ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">No unmatched threads.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {threads.map((thread, index) => (
            <li
              key={thread.id}
              className={cn(
                "space-y-2 px-3 py-3",
                index === selected && "bg-primary/10",
              )}
            >
              <div>
                <p className="text-sm font-medium">{thread.subject}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(thread.lastMessageAt)} ·{" "}
                  {thread.participantEmails.join(", ")}
                </p>
                {thread.snippet ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {thread.snippet}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-8 min-w-56 rounded-lg border border-input bg-background px-2 text-sm"
                  value={personByThread[thread.id] ?? ""}
                  onChange={(event) =>
                    setPersonByThread((current) => ({
                      ...current,
                      [thread.id]: event.target.value,
                    }))
                  }
                >
                  <option value="">Select person</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {personDisplayName(person)} · {person.email}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  disabled={!personByThread[thread.id]}
                  onClick={() => {
                    const personId = personByThread[thread.id];
                    if (personId) {
                      void linkThread(thread.id, personId);
                    }
                  }}
                >
                  Link
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
