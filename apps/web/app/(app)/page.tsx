"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  CompleteTaskBody,
  HomeEmailItem,
  HomeScheduleItem,
  HomeSnapshotResponse,
  HomeTodo,
  HomeTodoKind,
} from "@realm-labs/contracts";
import {
  groupHomeTodos,
  meetingTaskNeedsOutcome,
  personDisplayName,
  formatReportRate,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { formatDateTime, formatTime, formatWeekdayDate } from "@/lib/format";
import {
  isTypingTarget,
  useListNavigation,
} from "@/hooks/use-list-navigation";
import { useMe } from "@/hooks/use-me";
import { CompleteTaskForm } from "@/components/complete-task-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<HomeTodoKind, string> = {
  close_meeting: "Call",
  campaign_review: "Hot",
  needs_track: "Track",
  needs_review: "Review",
  task: "Task",
  email: "Email",
  call: "Call",
  decision: "Task",
  incubator: "Task",
};

const KIND_CLASS: Record<HomeTodoKind, string> = {
  close_meeting: "text-canary",
  campaign_review: "text-canary",
  needs_track: "text-canary",
  needs_review: "text-canary",
  task: "text-primary",
  email: "text-teal",
  call: "text-canary",
  decision: "text-primary",
  incubator: "text-primary",
};

function mailHref(item: HomeEmailItem): string {
  if (item.kind === "task") {
    return `/people/${item.person.id}`;
  }
  return item.person ? `/people/${item.person.id}` : "/inbox/unmatched";
}

export default function HomePage() {
  const router = useRouter();
  const { user } = useMe();
  const [includeAllOperators, setIncludeAllOperators] = useState(false);
  const [snapshot, setSnapshot] = useState<HomeSnapshotResponse | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const operators =
      user?.role === "admin" && includeAllOperators ? "all" : "mine";
    const res = await api<HomeSnapshotResponse>(`/home?operators=${operators}`);
    setSnapshot(res);
  }, [includeAllOperators, user?.role]);

  useEffect(() => {
    void load()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load home");
      })
      .finally(() => setLoaded(true));
  }, [load]);

  const todos = useMemo(() => snapshot?.todos ?? [], [snapshot?.todos]);
  const groups = useMemo(() => groupHomeTodos(todos), [todos]);
  const schedule = snapshot?.schedule ?? [];
  const emails = snapshot?.emails ?? [];
  const mailUnmatched = useMemo(() => {
    const listed = new Set(
      emails.flatMap((item) => (item.kind === "thread" ? [item.thread.id] : [])),
    );
    return groups.mail.filter((item) => {
      if (!item.id.startsWith("email:")) {
        return true;
      }
      return !listed.has(item.id.slice("email:".length));
    });
  }, [emails, groups.mail]);

  const navHrefs = useMemo(() => {
    const hrefs: string[] = [];
    for (const item of schedule) {
      hrefs.push(`/people/${item.person.id}`);
    }
    for (const item of groups.closeCalls) {
      hrefs.push(item.href);
    }
    for (const item of groups.followUps) {
      hrefs.push(item.href);
    }
    for (const item of groups.decisions) {
      hrefs.push(item.href);
    }
    for (const item of emails) {
      hrefs.push(mailHref(item));
    }
    for (const item of mailUnmatched) {
      hrefs.push(item.href);
    }
    return hrefs;
  }, [
    emails,
    groups.closeCalls,
    groups.decisions,
    groups.followUps,
    mailUnmatched,
    schedule,
  ]);

  const selected = useListNavigation(navHrefs.length);
  const scheduleOffset = 0;
  const closeOffset = scheduleOffset + schedule.length;
  const followOffset = closeOffset + groups.closeCalls.length;
  const decisionOffset = followOffset + groups.followUps.length;
  const mailOffset = decisionOffset + groups.decisions.length;
  const unmatchedOffset = mailOffset + emails.length;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || isTypingTarget(event.target)) {
        return;
      }
      const href = navHrefs[selected];
      if (!href) {
        return;
      }
      event.preventDefault();
      router.push(href);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navHrefs, router, selected]);

  async function completeMeetingTask(
    personId: string,
    taskId: string,
    body: CompleteTaskBody,
  ) {
    setError("");
    try {
      await api(`/people/${personId}/tasks/${taskId}/complete`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setCompletingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete task");
    }
  }

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
        {user?.role === "admin" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => setIncludeAllOperators((current) => !current)}
          >
            {includeAllOperators ? "Showing all operators" : "Mine only"}
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {snapshot?.deliverability ? (
        <p
          className={cn(
            "text-sm",
            snapshot.deliverability.watch
              ? "text-canary"
              : "text-muted-foreground",
          )}
        >
          Complaints this week{" "}
          {formatReportRate(snapshot.deliverability.complaintRate)}
          {snapshot.deliverability.watch ? " · watch 0.1%" : ""}
          {" · "}
          <Link href="/reports" className="hover:underline">
            Deliverability
          </Link>
        </p>
      ) : null}

      <HomeSection
        title="Schedule"
        hint="Calls and meetings on the calendar today."
      >
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : schedule.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No calls scheduled today.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {schedule.map((item, index) => (
              <ScheduleRow
                key={item.task.id}
                item={item}
                now={now}
                navIndex={scheduleOffset + index}
                active={selected === scheduleOffset + index}
              />
            ))}
          </ul>
        )}
      </HomeSection>

      {groups.closeCalls.length > 0 ? (
        <HomeSection
          title="Close calls"
          hint="Past calls still missing Held, No show, or Rescheduled."
        >
          <TodoList
            items={groups.closeCalls}
            startIndex={closeOffset}
            selected={selected}
            completingId={completingId}
            onToggleComplete={setCompletingId}
            onComplete={completeMeetingTask}
            onCancelComplete={() => setCompletingId(null)}
          />
        </HomeSection>
      ) : null}

      {groups.followUps.length > 0 ? (
        <HomeSection
          title="Follow-ups"
          hint="Open tasks due through today."
        >
          <TodoList
            items={groups.followUps}
            startIndex={followOffset}
            selected={selected}
            completingId={completingId}
            onToggleComplete={setCompletingId}
            onComplete={completeMeetingTask}
            onCancelComplete={() => setCompletingId(null)}
          />
        </HomeSection>
      ) : null}

      {groups.decisions.length > 0 ? (
        <HomeSection
          title="Needs a decision"
          hint="Track, review, and board waiting rooms."
        >
          <TodoList
            items={groups.decisions}
            startIndex={decisionOffset}
            selected={selected}
            completingId={completingId}
            onToggleComplete={setCompletingId}
            onComplete={completeMeetingTask}
            onCancelComplete={() => setCompletingId(null)}
          />
        </HomeSection>
      ) : null}

      <HomeSection
        title="Mail"
        hint="Email tasks due today, inbox activity today, and unmatched threads."
      >
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : emails.length === 0 && mailUnmatched.length === 0 ? (
          <p className="text-sm text-muted-foreground">No emails today.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {emails.map((item, index) => (
              <MailRow
                key={
                  item.kind === "task"
                    ? `task:${item.task.id}`
                    : `thread:${item.thread.id}`
                }
                item={item}
                navIndex={mailOffset + index}
                active={selected === mailOffset + index}
              />
            ))}
            {mailUnmatched.map((item, index) => (
              <TodoRow
                key={item.id}
                item={item}
                navIndex={unmatchedOffset + index}
                active={selected === unmatchedOffset + index}
                completingId={completingId}
                onToggleComplete={setCompletingId}
                onComplete={completeMeetingTask}
                onCancelComplete={() => setCompletingId(null)}
              />
            ))}
          </ul>
        )}
      </HomeSection>
    </div>
  );
}

function HomeSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {children}
    </section>
  );
}

function ScheduleRow({
  item,
  now,
  navIndex,
  active,
}: {
  item: HomeScheduleItem;
  now: Date;
  navIndex: number;
  active: boolean;
}) {
  const due = meetingTaskNeedsOutcome(
    item.task.dueAt,
    item.task.status,
    now,
    item.task.needsReview,
  );
  return (
    <li
      data-nav-index={navIndex}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-3 py-2",
        active && "bg-primary/10",
      )}
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
          {formatTime(item.task.dueAt)}
          {due ? " · needs outcome" : ""}
          {item.task.needsReview ? " · needs review" : ""}
        </p>
      </div>
    </li>
  );
}

function TodoList({
  items,
  startIndex,
  selected,
  completingId,
  onToggleComplete,
  onComplete,
  onCancelComplete,
}: {
  items: HomeTodo[];
  startIndex: number;
  selected: number;
  completingId: string | null;
  onToggleComplete: (id: string | null) => void;
  onComplete: (
    personId: string,
    taskId: string,
    body: CompleteTaskBody,
  ) => void;
  onCancelComplete: () => void;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((item, index) => (
        <TodoRow
          key={item.id}
          item={item}
          navIndex={startIndex + index}
          active={selected === startIndex + index}
          completingId={completingId}
          onToggleComplete={onToggleComplete}
          onComplete={onComplete}
          onCancelComplete={onCancelComplete}
        />
      ))}
    </ul>
  );
}

function TodoRow({
  item,
  navIndex,
  active,
  completingId,
  onToggleComplete,
  onComplete,
  onCancelComplete,
}: {
  item: HomeTodo;
  navIndex: number;
  active: boolean;
  completingId: string | null;
  onToggleComplete: (id: string | null) => void;
  onComplete: (
    personId: string,
    taskId: string,
    body: CompleteTaskBody,
  ) => void;
  onCancelComplete: () => void;
}) {
  return (
    <li
      data-nav-index={navIndex}
      className={cn("space-y-2 px-3 py-2", active && "bg-primary/10")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        {item.kind === "close_meeting" && item.taskId && item.personId ? (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() =>
              onToggleComplete(completingId === item.id ? null : item.id)
            }
          >
            Log call outcome
          </button>
        ) : null}
      </div>
      {completingId === item.id && item.taskId && item.personId ? (
        <CompleteTaskForm
          task={{ id: item.taskId, kind: "meeting", notes: null }}
          requireFollowUp={false}
          hasExistingFollowUp={item.hasOpenFollowUp}
          onCancel={onCancelComplete}
          onSubmit={(body) => {
            const personId = item.personId;
            const taskId = item.taskId;
            if (!personId || !taskId) {
              return;
            }
            onComplete(personId, taskId, body);
          }}
        />
      ) : null}
    </li>
  );
}

function MailRow({
  item,
  navIndex,
  active,
}: {
  item: HomeEmailItem;
  navIndex: number;
  active: boolean;
}) {
  if (item.kind === "task") {
    return (
      <li
        data-nav-index={navIndex}
        className={cn("px-3 py-2", active && "bg-primary/10")}
      >
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-[11px] uppercase tracking-wide text-teal">
            Email
          </span>
          <Link
            href={`/people/${item.person.id}`}
            className="text-sm font-medium hover:underline"
          >
            {personDisplayName(item.person)}
          </Link>
        </p>
        <p className="text-xs text-muted-foreground">
          {formatTime(item.task.dueAt)}
          {item.task.notes ? ` · ${item.task.notes}` : ""}
        </p>
      </li>
    );
  }
  const href = item.person
    ? `/people/${item.person.id}`
    : "/inbox/unmatched";
  return (
    <li
      data-nav-index={navIndex}
      className={cn("px-3 py-2", active && "bg-primary/10")}
    >
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[11px] uppercase tracking-wide text-teal">
          Email
        </span>
        <Link href={href} className="text-sm font-medium hover:underline">
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
}
