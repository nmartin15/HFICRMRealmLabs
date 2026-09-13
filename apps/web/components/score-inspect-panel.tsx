"use client";

import { useCallback, useEffect, useState } from "react";
import type { PersonInspectResponse } from "@realm-labs/contracts";
import {
  LEAD_TEMP_LABELS,
  OPERATOR_WARMTH_LABELS,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COMPONENT_LABEL: Record<string, string> = {
  affordability: "Affordability",
  conversations: "Conversations",
  application: "Application",
  replies: "Replies",
  qualification: "Qualification",
  extracted: "Extracted",
  operator: "Operator judgment",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function ScoreInspectPanel({
  personId,
  onChanged,
}: {
  personId: string;
  onChanged?: () => void;
}) {
  const [inspect, setInspect] = useState<PersonInspectResponse | null>(null);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api<PersonInspectResponse>(`/people/${personId}/inspect`);
    setInspect(data);
    return data;
  }, [personId]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load inspect");
    });
  }, [load]);

  async function invalidate(signalId: string) {
    setError("");
    setPendingId(signalId);
    try {
      const before = inspect?.snapshot?.computedAt ?? null;
      await api(`/people/${personId}/signals/${signalId}/invalidate`, {
        method: "POST",
      });
      let next = await load();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const computedAt = next.snapshot?.computedAt ?? null;
        if (computedAt && computedAt !== before) {
          break;
        }
        await sleep(400);
        next = await load();
      }
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invalidate");
    } finally {
      setPendingId(null);
    }
  }

  if (!inspect && !error) {
    return <p className="text-sm text-muted-foreground">Loading score…</p>;
  }

  const components = inspect?.components ?? [];
  const otherComponents = components.filter((row) => row.id !== "operator");
  const operatorComponent = components.find((row) => row.id === "operator");

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Score inspect</h2>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {inspect?.score ? (
        <div className="space-y-1 text-sm">
          <p>
            <span className="font-heading text-lg font-semibold tabular-nums">
              {inspect.score.score}
            </span>
            <span className="text-muted-foreground">
              {" "}
              · display {LEAD_TEMP_LABELS[inspect.score.displayBucket]} · campaign{" "}
              {LEAD_TEMP_LABELS[inspect.score.campaignBucket]}
            </span>
          </p>
          {inspect.score.explanation ? (
            <p className="text-sm text-canary">{inspect.score.explanation}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No score yet.</p>
      )}

      <ul className="divide-y rounded-lg border">
        {otherComponents.map((row) => (
          <li
            key={row.id}
            className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
          >
            <span>
              {COMPONENT_LABEL[row.id] ?? row.id}
              <span className="text-xs text-muted-foreground">
                {" "}
                · {row.reason}
              </span>
            </span>
            <span className="tabular-nums">
              {row.contribution}/{row.max}
            </span>
          </li>
        ))}
        <li className="space-y-1 px-3 py-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span>
              Operator judgment
              {inspect?.operator.active && inspect.operator.level ? (
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · {OPERATOR_WARMTH_LABELS[inspect.operator.level]}
                  {operatorComponent ? ` · ${operatorComponent.reason}` : ""}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · no active override
                </span>
              )}
            </span>
            <span className="tabular-nums">
              {inspect?.operator.contribution ?? 0}/
              {operatorComponent?.max ?? 10}
            </span>
          </div>
          {inspect?.operator.active ? (
            <p className="text-xs text-muted-foreground">
              {inspect.operator.contribution > 0 ? "+" : ""}
              {inspect.operator.contribution} now
              {inspect.operator.raw !== inspect.operator.contribution
                ? ` (was ${inspect.operator.raw > 0 ? "+" : ""}${inspect.operator.raw})`
                : ""}
              {inspect.operator.setBy
                ? ` · ${inspect.operator.setBy.name} (${inspect.operator.setBy.email})`
                : ""}
              {inspect.operator.setAt
                ? ` · ${formatDateTime(inspect.operator.setAt)}`
                : ""}
              {inspect.operator.daysUntilExpiry !== null
                ? ` · ~${inspect.operator.daysUntilExpiry}d left`
                : ""}
            </p>
          ) : null}
        </li>
      </ul>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border px-3 py-2 text-sm">
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Consent
          </p>
          {inspect?.consents.length ? (
            <ul className="mt-1 space-y-1">
              {inspect.consents.map((row) => (
                <li key={row.channel}>
                  {row.channel} · {row.status} · {row.source}
                  {row.grantedAt ? ` · ${formatDateTime(row.grantedAt)}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted-foreground">None recorded.</p>
          )}
        </div>
        <div className="rounded-lg border px-3 py-2 text-sm">
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Suppression
          </p>
          {inspect?.suppression ? (
            <p className="mt-1">
              {inspect.suppression.reason} · {inspect.suppression.source} ·{" "}
              {formatDateTime(inspect.suppression.occurredAt)}
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">Not suppressed.</p>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-muted-foreground">
          Extracted signals with source and justifying text. Invalidate rescores
          immediately.
        </p>
        <ul className="divide-y rounded-lg border">
          {(inspect?.signals ?? []).map((row) => (
            <li
              key={row.id}
              className={cn(
                "space-y-1 px-3 py-2 text-sm",
                row.invalidatedAt && "text-muted-foreground",
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p>
                  <span className="font-mono text-[11px] uppercase tracking-wide">
                    {row.kind}
                  </span>{" "}
                  · {row.sourceType} · {row.extractor}
                </p>
                {!row.invalidatedAt ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pendingId === row.id}
                    onClick={() => void invalidate(row.id)}
                  >
                    Invalidate
                  </Button>
                ) : (
                  <span className="text-xs">
                    Invalidated {formatDateTime(row.invalidatedAt)}
                  </span>
                )}
              </div>
              <p className={cn("text-xs", row.invalidatedAt && "line-through")}>
                {row.excerpt || "No excerpt"} · {formatDateTime(row.createdAt)}
              </p>
            </li>
          ))}
          {inspect?.signals.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No extracted signals.
            </li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}
