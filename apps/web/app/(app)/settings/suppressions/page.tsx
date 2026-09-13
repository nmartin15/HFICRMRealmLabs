"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SuppressionAuditListResponse } from "@realm-labs/contracts";
import { canInspectScoring } from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useMe } from "@/hooks/use-me";
import { cn } from "@/lib/utils";

export default function SuppressionsAuditPage() {
  const { user, loading } = useMe();
  const [rows, setRows] = useState<SuppressionAuditListResponse["data"]>([]);
  const [error, setError] = useState("");
  const selected = useListNavigation(rows.length);

  const load = useCallback(async () => {
    const data = await api<SuppressionAuditListResponse>("/suppressions");
    setRows(data.data);
  }, []);

  useEffect(() => {
    if (!user || !canInspectScoring(user.role)) {
      return;
    }
    void load().catch((err: unknown) => {
      setError(
        err instanceof Error ? err.message : "Failed to load suppressions",
      );
    });
  }, [load, user]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!user || !canInspectScoring(user.role)) {
    return <p className="text-sm text-destructive">Admin only.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link href="/settings" className="hover:underline">
            Settings
          </Link>
        </p>
        <h1 className="text-xl font-medium tracking-tight">Suppressions</h1>
        <p className="text-sm text-muted-foreground">
          Every suppressed address, when, why, and what triggered it. j/k to
          move.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <ul className="divide-y rounded-lg border">
        {rows.map((row, index) => (
          <li
            key={row.id}
            data-nav-index={index}
            className={cn(
              "space-y-1 px-3 py-2 text-sm",
              index === selected && "bg-primary/10",
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                {row.email ?? `${row.emailHash.slice(0, 12)}…`}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(row.occurredAt)}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {row.reason} · source {row.source} · trigger {row.trigger ?? "—"}
              {row.purgedAt ? ` · purged ${formatDateTime(row.purgedAt)}` : ""}
            </p>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">
            No suppressions.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
