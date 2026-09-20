"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  MailTemplate,
  MailTemplateListResponse,
  MailTemplateUpsertBody,
} from "@realm-labs/contracts";
import {
  MAIL_TEMPLATE_CATALOG,
  canInspectScoring,
  mailTemplateKey,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default function MailTemplatesPage() {
  const { user, loading } = useMe();
  const [rows, setRows] = useState<MailTemplate[]>([]);
  const [error, setError] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [saving, setSaving] = useState(false);
  const index = useListNavigation(MAIL_TEMPLATE_CATALOG.length);
  const selected = MAIL_TEMPLATE_CATALOG[index];

  const byKey = useMemo(() => {
    const map = new Map<string, MailTemplate>();
    for (const row of rows) {
      map.set(mailTemplateKey(row), row);
    }
    return map;
  }, [rows]);

  const load = useCallback(async () => {
    const res = await api<MailTemplateListResponse>("/mail-templates");
    setRows(res.data);
  }, []);

  useEffect(() => {
    if (!user || !canInspectScoring(user.role)) {
      return;
    }
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    });
  }, [load, user]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    const saved = byKey.get(mailTemplateKey(selected));
    setSubject(saved?.subject ?? "");
    setBodyText(saved?.bodyText ?? "");
  }, [byKey, selected]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!user || !canInspectScoring(user.role)) {
    return <p className="text-sm text-destructive">Admin only.</p>;
  }
  if (!selected) {
    return null;
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      const body: MailTemplateUpsertBody = {
        lane: selected.lane,
        program: selected.program,
        stage: selected.stage,
        purpose: selected.purpose,
        subject,
        bodyText,
      };
      const saved = await api<MailTemplate>("/mail-templates", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setRows((current) => {
        const next = current.filter(
          (row) => mailTemplateKey(row) !== mailTemplateKey(saved),
        );
        next.push(saved);
        return next;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link href="/settings" className="hover:underline">
            Settings
          </Link>
        </p>
        <h1 className="text-xl font-medium tracking-tight">Applicant mail</h1>
        <p className="text-sm text-muted-foreground">
          Stage emails only. Empty copy means no send. j/k to move, esc to
          leave a field. Merge {`{{name}}`}, {`{{firstName}}`}, {`{{program}}`},{" "}
          {`{{stage}}`}.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
        <ul className="divide-y rounded-lg border">
          {MAIL_TEMPLATE_CATALOG.map((entry, entryIndex) => {
            const saved = byKey.get(mailTemplateKey(entry));
            const blank =
              !saved ||
              saved.subject.trim().length === 0 ||
              saved.bodyText.trim().length === 0;
            return (
              <li key={mailTemplateKey(entry)}>
                <button
                  type="button"
                  data-nav-index={entryIndex}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-sm",
                    entryIndex === index && "bg-primary/10",
                  )}
                >
                  <span>{entry.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {blank ? "empty" : "set"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="space-y-3">
          <p className="text-sm font-medium">{selected.label}</p>
          <div className="space-y-1">
            <Label htmlFor="mail-subject">Subject</Label>
            <Input
              id="mail-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mail-body">Body</Label>
            <textarea
              id="mail-body"
              rows={12}
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
