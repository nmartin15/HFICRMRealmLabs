"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type {
  Person,
  PersonDetailResponse,
  PersonPatch,
  TimelineItem,
  User,
  UserListResponse,
} from "@realm-labs/contracts";
import {
  ALLOCATION_STAGE_LABELS,
  INCUBATOR_STAGE_LABELS,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { activitySummary } from "@/lib/activity-summary";
import { formatDate, formatDateTime } from "@/lib/format";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { MeetingOutcomeButtons } from "@/components/meeting-outcome-buttons";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<Person["source"], string> = {
  linkedin: "LinkedIn",
  workable: "Workable",
  referral: "Referral",
  other: "Other",
};

function boardLabel(board: NonNullable<PersonDetailResponse["board"]>): string {
  if (board.board === "allocation") {
    return `Allocation · ${ALLOCATION_STAGE_LABELS[board.stage]}`;
  }
  return `Incubator · ${INCUBATOR_STAGE_LABELS[board.stage]}`;
}

export default function PersonRecordPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<PersonDetailResponse | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    const [personRes, userRes] = await Promise.all([
      api<PersonDetailResponse>(`/people/${id}`),
      api<UserListResponse>("/users"),
    ]);
    setDetail(personRes);
    setNotes(personRes.person.notes ?? "");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  if (!detail && !error) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!detail) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  const person = detail.person;
  const name = `${person.firstName} ${person.lastName}`;

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
            <dd>
              {person.resumeUrl ? (
                <a
                  href={person.resumeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  Open resume
                </a>
              ) : (
                "—"
              )}
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
            <option value="hot">hot</option>
            <option value="warm">warm</option>
            <option value="cold">cold</option>
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
            <option value="yes">yes</option>
            <option value="no">no</option>
            <option value="unknown">unknown</option>
          </select>
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
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
        <div className="space-y-1">
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
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => {
              if (notes !== (person.notes ?? "")) {
                void patch({ notes: notes.trim() ? notes : null });
              }
            }}
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
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
