"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HomeSnapshotResponse, HomeTodoKind } from "@realm-labs/contracts";
import {
  meetingNeedsOutcome,
  personDisplayName,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { formatDateTime, formatTime, formatWeekdayDate } from "@/lib/format";
import {
  isTypingTarget,
  useListNavigation,
} from "@/hooks/use-list-navigation";
import { MeetingOutcomeButtons } from "@/components/meeting-outcome-buttons";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<HomeTodoKind, string> = {
  close_meeting: "Call",
  task: "Task",
  email: "Email",
  call: "Call",
  decision: "Task",
  incubator: "Task",
};

const KIND_CLASS: Record<HomeTodoKind, string> = {
  close_meeting: "text-canary",
  task: "text-primary",
  email: "text-teal",
  call: "text-canary",
  decision: "text-primary",
  incubator: "text-primary",
};

export default function HomePage() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<HomeSnapshotResponse | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await api<HomeSnapshotResponse>("/home");
    setSnapshot(res);
  }, []);

  useEffect(() => {
    void load()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load home");
      })
      .finally(() => setLoaded(true));
  }, [load]);

  const todos = snapshot?.todos ?? [];
  const selected = useListNavigation(todos.length);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || isTypingTarget(event.target)) {
        return;
      }
      const item = todos[selected];
      if (!item) {
        return;
      }
      event.preventDefault();
      router.push(item.href);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, selected, todos]);

  const counts = snapshot?.counts;
  const now = new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          Today
        </h1>
        <p className="text-sm text-muted-foreground">
          {snapshot ? formatWeekdayDate(snapshot.date) : "To-do and the day."}{" "}
          j/k to move, enter to open.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {counts ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CountChip label="To do" value={counts.todo} />
          <CountChip label="Meetings" value={counts.meetings} />
          <CountChip label="Calls" value={counts.calls} />
          <CountChip label="Emails" value={counts.emails} />
        </dl>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">To do</h2>
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : todos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing due.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {todos.map((item, index) => (
              <li
                key={item.id}
                data-nav-index={index}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 px-3 py-2",
                  index === selected && "bg-primary/10",
                )}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={cn(
                        "font-mono text-[11px] uppercase tracking-wide",
                        KIND_CLASS[item.kind],
                      )}
                    >
                      {KIND_LABEL[item.kind]}
                    </span>
                    <Link
                      href={item.href}
                      className="text-sm font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.at
                      ? `${formatDateTime(item.at)} · ${item.detail}`
                      : item.detail}
                  </p>
                </div>
                {item.kind === "close_meeting" && item.meetingId ? (
                  <MeetingOutcomeButtons
                    meetingId={item.meetingId}
                    onUpdated={() => void load()}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Schedule</h2>
        <p className="text-xs text-muted-foreground">
          Calls and meetings on the calendar today.
        </p>
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !snapshot || snapshot.schedule.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No calls scheduled today.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {snapshot.schedule.map((item) => {
              const due = meetingNeedsOutcome(
                item.meeting.scheduledAt,
                item.meeting.outcome,
                now,
              );
              return (
                <li
                  key={item.meeting.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                >
                  <div>
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-canary">
                        Call
                      </span>
                      <Link
                        href={`/people/${item.person.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {personDisplayName(item.person)}
                      </Link>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatTime(item.meeting.scheduledAt)}
                      {due ? " · needs outcome" : ""}
                      {item.meeting.needsReview ? " · needs review" : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Emails today</h2>
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !snapshot || snapshot.emails.length === 0 ? (
          <p className="text-sm text-muted-foreground">No emails today.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {snapshot.emails.map((item) => {
              const href = item.person
                ? `/people/${item.person.id}`
                : "/inbox/unmatched";
              return (
                <li key={item.thread.id} className="px-3 py-2">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-teal">
                      Email
                    </span>
                    <Link
                      href={href}
                      className="text-sm font-medium hover:underline"
                    >
                      {item.thread.subject || "(no subject)"}
                    </Link>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatTime(item.thread.lastMessageAt)}
                    {item.person
                      ? ` · ${personDisplayName(item.person)}`
                      : " · unmatched"}
                  </p>
                  {item.thread.snippet ? (
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {item.thread.snippet}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <dt className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-heading text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
