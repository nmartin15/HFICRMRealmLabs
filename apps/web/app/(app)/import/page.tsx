"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ImportCommitResponse,
  ImportPreviewResponse,
  ImportPreviewRow,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import {
  isTypingTarget,
  useListNavigation,
} from "@/hooks/use-list-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default function ImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [result, setResult] = useState<ImportCommitResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);

  const rows = preview?.rows ?? [];
  const selected = useListNavigation(rows.length);
  const focused = rows[selected];
  const committable = preview
    ? preview.counts.create + preview.counts.update
    : 0;

  const reset = useCallback(() => {
    setFilename("");
    setContent("");
    setPreview(null);
    setResult(null);
    setError("");
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        reset();
        return;
      }
      if (event.key === "Enter" && focused?.existingPersonId) {
        event.preventDefault();
        router.push(`/people/${focused.existingPersonId}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused, reset, router]);

  async function previewFile(file: File) {
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const text = await file.text();
      const data = await api<ImportPreviewResponse>("/import/preview", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, content: text }),
      });
      setFilename(file.name);
      setContent(text);
      setPreview(data);
      fileRef.current?.blur();
    } catch (err) {
      setPreview(null);
      setFilename("");
      setContent("");
      setError(err instanceof Error ? err.message : "Failed to preview import");
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!filename || !content || committable === 0) {
      return;
    }
    setError("");
    setCommitting(true);
    try {
      const data = await api<ImportCommitResponse>("/import/commit", {
        method: "POST",
        body: JSON.stringify({ filename, content }),
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to commit import");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-medium tracking-tight">Import</h1>
        <p className="text-xs text-muted-foreground">
          CSV or TSV of the applicant sheet. j/k to move, enter to open an
          existing person, esc to reset.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="import-file">Spreadsheet</Label>
          <Input
            ref={fileRef}
            id="import-file"
            type="file"
            accept=".csv,.tsv,.tab,text/csv,text/tab-separated-values"
            className="w-72"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void previewFile(file);
              }
            }}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={!filename && !preview && !error}
        >
          Reset
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void commit()}
          disabled={!preview || committable === 0 || committing || Boolean(result)}
        >
          {committing ? "Committing…" : "Commit"}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Reading spreadsheet…</p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {result ? (
        <p className="text-sm">
          Imported {result.filename}: {result.created} created, {result.updated}{" "}
          updated, {result.skipped} skipped.
        </p>
      ) : null}

      {preview ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {preview.filename} · {preview.counts.create} create ·{" "}
            {preview.counts.update} update · {preview.counts.skip} skip
          </p>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data rows.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row, index) => (
                    <PreviewRow
                      key={`${row.rowNumber}-${row.email ?? ""}`}
                      row={row}
                      selected={index === selected}
                      onOpen={
                        row.existingPersonId
                          ? () => router.push(`/people/${row.existingPersonId}`)
                          : undefined
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PreviewRow({
  row,
  selected,
  onOpen,
}: {
  row: ImportPreviewRow;
  selected: boolean;
  onOpen?: () => void;
}) {
  return (
    <tr className={cn(selected && "bg-primary/10")}>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {row.rowNumber}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-xs capitalize",
          row.action === "skip" && "text-destructive",
          row.action === "update" && "text-muted-foreground",
        )}
      >
        {row.action}
      </td>
      <td className="px-3 py-2">
        {onOpen ? (
          <button type="button" className="hover:underline" onClick={onOpen}>
            {row.name ?? "—"}
          </button>
        ) : (
          (row.name ?? "—")
        )}
      </td>
      <td className="px-3 py-2 font-mono text-xs">{row.email ?? "—"}</td>
      <td className="px-3 py-2 text-xs text-destructive">
        {row.errors.join("; ")}
      </td>
    </tr>
  );
}
