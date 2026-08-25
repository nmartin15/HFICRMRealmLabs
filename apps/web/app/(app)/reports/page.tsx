"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReportRange, ReportResponse } from "@realm-labs/contracts";
import {
  currentWeekRange,
  formatReportRate,
  reportExportFilename,
  reportTableCsv,
  reportTableTsv,
  shiftWeek,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type View = "total" | "weekly";

function rangeQuery(range: ReportRange): string {
  if (range.kind === "all_time") {
    return "";
  }
  return `?start=${range.start}&end=${range.end}`;
}

function downloadCsv(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [view, setView] = useState<View>("total");
  const [week, setWeek] = useState(() => currentWeekRange());
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const range: ReportRange = useMemo(
    () =>
      view === "total"
        ? { kind: "all_time" }
        : { kind: "range", start: week.start, end: week.end },
    [view, week.end, week.start],
  );

  const load = useCallback(async () => {
    if (range.kind === "range" && range.start > range.end) {
      setError("start must be on or before end");
      setReport(null);
      return;
    }
    const data = await api<ReportResponse>(`/reports${rangeQuery(range)}`);
    setError("");
    setReport(data);
  }, [range]);

  useEffect(() => {
    setError("");
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load report");
    });
  }, [load]);

  const rows = report?.rows ?? [];
  const selected = useListNavigation(rows.length);

  const rangeLabel =
    range.kind === "all_time" ? "All time" : `${range.start} → ${range.end}`;

  function exportCsv() {
    if (!report) {
      return;
    }
    downloadCsv(reportExportFilename(report.range), reportTableCsv(report.rows));
  }

  async function copyTsv() {
    if (!report) {
      return;
    }
    const text = reportTableTsv(report.rows);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("clipboard unavailable");
      }
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const copiedWithExec = document.execCommand("copy");
      textarea.remove();
      if (!copiedWithExec) {
        setError("Could not copy TSV");
        return;
      }
    }
    setError("");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-medium tracking-tight">Reports</h1>
        <p className="text-xs text-muted-foreground">
          {rangeLabel}. j/k to move rows. LinkedIn numbers come from Settings.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={view === "total" ? "default" : "ghost"}
          onClick={() => setView("total")}
        >
          Dynamic Total
        </Button>
        <Button
          type="button"
          size="sm"
          variant={view === "weekly" ? "default" : "ghost"}
          onClick={() => setView("weekly")}
        >
          Weekly Snapshot
        </Button>
      </div>

      {view === "weekly" ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="report-start">Start</Label>
            <Input
              id="report-start"
              type="date"
              value={week.start}
              onChange={(event) =>
                setWeek((current) => ({ ...current, start: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="report-end">End</Label>
            <Input
              id="report-end"
              type="date"
              value={week.end}
              onChange={(event) =>
                setWeek((current) => ({ ...current, end: event.target.value }))
              }
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setWeek((current) => shiftWeek(current, -1))}
          >
            Prev week
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setWeek((current) => shiftWeek(current, 1))}
          >
            Next week
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!report}
          onClick={exportCsv}
        >
          Export CSV
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!report}
          onClick={() => void copyTsv()}
        >
          {copied ? "Copied" : "Copy as TSV"}
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!report && !error ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}

      {report ? (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Metric</th>
                  <th className="px-3 py-2 font-medium">Count</th>
                  <th className="px-3 py-2 font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b last:border-0",
                      index === selected && "bg-primary/10",
                    )}
                  >
                    <td className="px-3 py-2">{row.label}</td>
                    <td className="px-3 py-2 tabular-nums">{row.count}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatReportRate(row.rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{report.footnote}</p>
        </>
      ) : null}
    </div>
  );
}
