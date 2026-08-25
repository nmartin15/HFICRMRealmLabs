"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  GoogleStartResponse,
  Mailbox,
  MailboxConnectionListResponse,
  ReportInput,
  ReportInputListResponse,
  User,
  UserListResponse,
  UserRole,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type SettingsRow =
  | { kind: "mailbox"; id: string }
  | { kind: "member"; id: string }
  | { kind: "report"; id: string };

export default function SettingsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <SettingsForm />
    </Suspense>
  );
}

function MailboxOauthError() {
  const searchParams = useSearchParams();
  const code = searchParams.get("error");
  if (!code) {
    return null;
  }
  return (
    <p className="text-sm text-destructive">
      {searchParams.get("message") || "Mailbox connect failed."}
    </p>
  );
}

function SettingsForm() {
  const { user } = useMe();
  const [mailboxes, setMailboxes] = useState<MailboxConnectionListResponse["data"]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [reports, setReports] = useState<ReportInput[]>([]);
  const [error, setError] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [impressions, setImpressions] = useState("");
  const [applies, setApplies] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [mailboxRes, memberRes, reportRes] = await Promise.all([
      api<MailboxConnectionListResponse>("/mailboxes"),
      api<UserListResponse>("/users"),
      api<ReportInputListResponse>("/report-inputs"),
    ]);
    setMailboxes(mailboxRes.data);
    setMembers(memberRes.data);
    setReports(reportRes.data);
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    });
  }, [load]);

  const rows = useMemo<SettingsRow[]>(() => {
    return [
      ...mailboxes.map((item) => ({ kind: "mailbox" as const, id: item.email })),
      ...members.map((item) => ({ kind: "member" as const, id: item.id })),
      ...reports.map((item) => ({ kind: "report" as const, id: item.id })),
    ];
  }, [mailboxes, members, reports]);

  const selected = useListNavigation(rows.length);
  const selectedRow = rows[selected];

  async function changeRole(id: string, role: UserRole) {
    setError("");
    try {
      await api<User>(`/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    }
  }

  async function saveReport() {
    setError("");
    try {
      const body = {
        periodStart,
        periodEnd,
        linkedinImpressions: Number(impressions),
        jobPostApplies: Number(applies),
      };
      if (editingId) {
        await api<ReportInput>(`/report-inputs/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api<ReportInput>("/report-inputs", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      setPeriodStart("");
      setPeriodEnd("");
      setImpressions("");
      setApplies("");
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save report input");
    }
  }

  async function deleteReport(id: string) {
    setError("");
    try {
      await api(`/report-inputs/${id}`, { method: "DELETE" });
      if (editingId === id) {
        setEditingId(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete report input");
    }
  }

  function startEdit(row: ReportInput) {
    setEditingId(row.id);
    setPeriodStart(row.periodStart);
    setPeriodEnd(row.periodEnd);
    setImpressions(String(row.linkedinImpressions));
    setApplies(String(row.jobPostApplies));
  }

  async function connectMailbox(mailbox: Mailbox) {
    setError("");
    try {
      const { url } = await api<GoogleStartResponse>(
        `/mailboxes/${mailbox}/google`,
        { method: "POST" },
      );
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start connect");
    }
  }

  async function disconnectMailbox(mailbox: Mailbox) {
    setError("");
    try {
      await api(`/mailboxes/${mailbox}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    }
  }

  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-medium tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          j/k to move between rows, esc to leave a field.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <MailboxOauthError />

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Connected mailboxes</h2>
        <ul className="divide-y rounded-lg border">
          {mailboxes.map((mailbox) => (
            <li
              key={mailbox.email}
              className={cn(
                "flex items-center justify-between gap-3 px-3 py-2 text-sm",
                selectedRow?.kind === "mailbox" &&
                  selectedRow.id === mailbox.email &&
                  "bg-primary/10",
              )}
            >
              <div>
                <p>{mailbox.label}</p>
                <p className="text-xs text-muted-foreground">{mailbox.email}</p>
                <p className="text-xs text-muted-foreground">
                  {mailbox.connected
                    ? mailbox.lastSyncedAt
                      ? `Last synced ${formatDateTime(mailbox.lastSyncedAt)}`
                      : "Connected, waiting for first sync"
                    : "Not connected"}
                </p>
                {mailbox.lastError ? (
                  <p className="text-xs text-destructive">{mailbox.lastError}</p>
                ) : null}
              </div>
              {isAdmin ? (
                mailbox.connected ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void disconnectMailbox(mailbox.mailbox)}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void connectMailbox(mailbox.mailbox)}
                  >
                    Connect
                  </Button>
                )
              ) : (
                <span className="text-xs text-muted-foreground">
                  {mailbox.connected ? "Connected" : "Not connected"}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Team members</h2>
        <ul className="divide-y rounded-lg border">
          {members.map((member) => (
            <li
              key={member.id}
              className={cn(
                "flex items-center justify-between gap-3 px-3 py-2 text-sm",
                selectedRow?.kind === "member" &&
                  selectedRow.id === member.id &&
                  "bg-primary/10",
              )}
            >
              <div>
                <p>{member.name}</p>
                <p className="text-xs text-muted-foreground">{member.email}</p>
              </div>
              {isAdmin ? (
                <select
                  className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                  value={member.role}
                  onChange={(event) =>
                    void changeRole(member.id, event.target.value as UserRole)
                  }
                >
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                </select>
              ) : (
                <span className="text-xs text-muted-foreground">{member.role}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Report inputs</h2>
        <form
          className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveReport();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="periodStart">Period start</Label>
            <Input
              id="periodStart"
              type="date"
              required
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="periodEnd">Period end</Label>
            <Input
              id="periodEnd"
              type="date"
              required
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="impressions">LinkedIn impressions</Label>
            <Input
              id="impressions"
              type="number"
              min={0}
              required
              value={impressions}
              onChange={(event) => setImpressions(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="applies">Job post applies</Label>
            <Input
              id="applies"
              type="number"
              min={0}
              required
              value={applies}
              onChange={(event) => setApplies(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="submit" size="sm">
              {editingId ? "Update period" : "Add period"}
            </Button>
            {editingId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingId(null);
                  setPeriodStart("");
                  setPeriodEnd("");
                  setImpressions("");
                  setApplies("");
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>

        <ul className="divide-y rounded-lg border">
          {reports.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No periods yet.</li>
          ) : (
            reports.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2 text-sm",
                  selectedRow?.kind === "report" &&
                    selectedRow.id === row.id &&
                    "bg-primary/10",
                )}
              >
                <div>
                  <p>
                    {row.periodStart} → {row.periodEnd}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.linkedinImpressions} impressions · {row.jobPostApplies}{" "}
                    applies · {formatDateTime(row.updatedAt)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(row)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => void deleteReport(row.id)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
