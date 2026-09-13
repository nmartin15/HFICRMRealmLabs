"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type {
  OverrideRollupResponse,
  ScoreConfigPreviewResponse,
  ScoreConfigResponse,
  ScoreFormulaConfig,
} from "@realm-labs/contracts";
import {
  LEAD_TEMP_LABELS,
  PROGRAM_TRACK_LABELS,
  canInspectScoring,
  leadTempSchema,
  programInterestSchema,
  scoreConfigSaveBodySchema,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const INTERESTS = programInterestSchema.options;
const BUCKETS = leadTempSchema.options;

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        className="w-24"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function NullableNumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        className="w-24"
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
      />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-lg border px-3 py-3">
      <h2 className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function saveBody(config: ScoreFormulaConfig) {
  return scoreConfigSaveBodySchema.parse({ config });
}

export default function ScoringSettingsPage() {
  const { user, loading } = useMe();
  const [configRes, setConfigRes] = useState<ScoreConfigResponse | null>(null);
  const [draft, setDraft] = useState<ScoreFormulaConfig | null>(null);
  const [rollup, setRollup] = useState<OverrideRollupResponse | null>(null);
  const [preview, setPreview] = useState<ScoreConfigPreviewResponse | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);

  const load = useCallback(async () => {
    const [config, overrides] = await Promise.all([
      api<ScoreConfigResponse>("/scoring/config"),
      api<OverrideRollupResponse>("/scoring/overrides"),
    ]);
    setConfigRes(config);
    setDraft(config.config);
    setRollup(overrides);
  }, []);

  useEffect(() => {
    if (!user || !canInspectScoring(user.role)) {
      return;
    }
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load scoring");
    });
  }, [load, user]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!user || !canInspectScoring(user.role)) {
    return <p className="text-sm text-destructive">Admin only.</p>;
  }

  async function previewConfig() {
    if (!draft) {
      return;
    }
    setError("");
    setBusy("preview");
    try {
      const data = await api<ScoreConfigPreviewResponse>(
        "/scoring/config/preview",
        {
          method: "POST",
          body: JSON.stringify(saveBody(draft)),
        },
      );
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview");
    } finally {
      setBusy(null);
    }
  }

  async function saveConfig() {
    if (!draft) {
      return;
    }
    setError("");
    setBusy("save");
    try {
      const saved = await api<ScoreConfigResponse>("/scoring/config", {
        method: "POST",
        body: JSON.stringify(saveBody(draft)),
      });
      setConfigRes(saved);
      setDraft(saved.config);
      setPreview(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link href="/settings" className="hover:underline">
            Settings
          </Link>
        </p>
        <h1 className="text-xl font-medium tracking-tight">Scoring</h1>
        <p className="text-sm text-muted-foreground">
          Preview redistributes recorded snapshots. Save inserts a new config
          version.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {rollup ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Override rollup</h2>
          <ul className="divide-y rounded-lg border">
            <li className="flex justify-between gap-3 px-3 py-2 text-sm">
              <span>Active overrides</span>
              <span className="tabular-nums">{rollup.activeCount}</span>
            </li>
            <li className="flex justify-between gap-3 px-3 py-2 text-sm">
              <span>Average age</span>
              <span className="tabular-nums">{rollup.averageAgeDays}d</span>
            </li>
            <li
              className={cn(
                "flex justify-between gap-3 px-3 py-2 text-sm",
                rollup.againstComputedCount > 0 && "text-canary",
              )}
            >
              <span>Pulling against computed direction</span>
              <span className="tabular-nums">
                {rollup.againstComputedCount} ·{" "}
                {Math.round(rollup.againstComputedRate * 100)}%
              </span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            A rising against-computed rate is a tuning alarm, not a feature
            working.
          </p>
        </section>
      ) : null}

      {configRes && draft ? (
        <>
          <p className="text-sm text-muted-foreground">
            Current {configRes.version}
            {configRes.createdBy ? ` · ${configRes.createdBy.email}` : ""} ·{" "}
            {formatDateTime(configRes.createdAt)}
          </p>

          <div className="grid gap-3 lg:grid-cols-2">
            <Section title="Weights">
              {(
                [
                  "affordability",
                  "conversations",
                  "application",
                  "replies",
                  "qualification",
                ] as const
              ).map((key) => (
                <NumberField
                  key={key}
                  id={`weight-${key}`}
                  label={key}
                  value={draft.weights[key]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      weights: { ...draft.weights, [key]: value },
                    })
                  }
                />
              ))}
            </Section>
            <Section title="Hysteresis">
              <NumberField
                id="enter-lukewarm"
                label="Enter lukewarm"
                value={draft.hysteresis.enter.lukewarm}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    hysteresis: {
                      ...draft.hysteresis,
                      enter: { ...draft.hysteresis.enter, lukewarm: value },
                    },
                  })
                }
              />
              <NumberField
                id="enter-warm"
                label="Enter warm"
                value={draft.hysteresis.enter.warm}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    hysteresis: {
                      ...draft.hysteresis,
                      enter: { ...draft.hysteresis.enter, warm: value },
                    },
                  })
                }
              />
              <NumberField
                id="enter-hot"
                label="Enter hot"
                value={draft.hysteresis.enter.hot}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    hysteresis: {
                      ...draft.hysteresis,
                      enter: { ...draft.hysteresis.enter, hot: value },
                    },
                  })
                }
              />
              <NumberField
                id="exit-lukewarm"
                label="Exit lukewarm"
                value={draft.hysteresis.exit.lukewarm}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    hysteresis: {
                      ...draft.hysteresis,
                      exit: { ...draft.hysteresis.exit, lukewarm: value },
                    },
                  })
                }
              />
              <NumberField
                id="exit-warm"
                label="Exit warm"
                value={draft.hysteresis.exit.warm}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    hysteresis: {
                      ...draft.hysteresis,
                      exit: { ...draft.hysteresis.exit, warm: value },
                    },
                  })
                }
              />
              <NumberField
                id="exit-hot"
                label="Exit hot"
                value={draft.hysteresis.exit.hot}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    hysteresis: {
                      ...draft.hysteresis,
                      exit: { ...draft.hysteresis.exit, hot: value },
                    },
                  })
                }
              />
            </Section>
            <Section title="Operator">
              <NumberField
                id="op-max"
                label="Max contribution"
                value={draft.operator.maxContribution}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    operator: { ...draft.operator, maxContribution: value },
                  })
                }
              />
              <NumberField
                id="op-min"
                label="Min contribution"
                value={draft.operator.minContribution}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    operator: { ...draft.operator, minContribution: value },
                  })
                }
              />
              {(
                ["skeptical", "watch", "pursue", "priority"] as const
              ).map((level) => (
                <NumberField
                  key={level}
                  id={`op-${level}`}
                  label={level}
                  value={draft.operator.pointsByLevel[level]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      operator: {
                        ...draft.operator,
                        pointsByLevel: {
                          ...draft.operator.pointsByLevel,
                          [level]: value,
                        },
                      },
                    })
                  }
                />
              ))}
              <NumberField
                id="op-half"
                label="Half-life days"
                value={draft.operator.halfLifeDays}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    operator: { ...draft.operator, halfLifeDays: value },
                  })
                }
              />
              <NumberField
                id="op-max-age"
                label="Max age days"
                value={draft.operator.maxAgeDays}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    operator: { ...draft.operator, maxAgeDays: value },
                  })
                }
              />
            </Section>
            <Section title="Caps">
              <NumberField
                id="cap-unknown"
                label="Unknown budget max"
                value={draft.caps.unknownBudgetMaxScore}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    caps: { ...draft.caps, unknownBudgetMaxScore: value },
                  })
                }
              />
              <NumberField
                id="cap-nq"
                label="Not qualified max"
                value={draft.caps.notQualifiedMaxScore}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    caps: { ...draft.caps, notQualifiedMaxScore: value },
                  })
                }
              />
            </Section>
            <Section title="Affordability">
              {(
                [
                  "notQualified",
                  "unknown",
                  "lightUnpriced",
                  "lightFull",
                  "lightMid",
                  "lightOutOfRange",
                  "heavy",
                  "lightFullAtOrBelowUsd",
                  "outOfRangeAtOrAboveUsd",
                ] as const
              ).map((key) => (
                <NumberField
                  key={key}
                  id={`aff-${key}`}
                  label={key}
                  value={draft.affordability[key]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      affordability: {
                        ...draft.affordability,
                        [key]: value,
                      },
                    })
                  }
                />
              ))}
              {(
                ["tier_1", "tier_2", "tier_3", "tier_4"] as const
              ).map((tier) => (
                <NullableNumberField
                  key={tier}
                  id={`price-${tier}`}
                  label={`${tier} default USD`}
                  value={draft.affordability.defaultPriceUsd[tier]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      affordability: {
                        ...draft.affordability,
                        defaultPriceUsd: {
                          ...draft.affordability.defaultPriceUsd,
                          [tier]: value,
                        },
                      },
                    })
                  }
                />
              ))}
            </Section>
            <Section title="Conversations">
              {draft.conversations.pointsByCount.map((value, index) => (
                <NumberField
                  key={`conv-${index}`}
                  id={`conv-${index}`}
                  label={`Count ${index}`}
                  value={value}
                  onChange={(next) => {
                    const pointsByCount = [
                      ...draft.conversations.pointsByCount,
                    ] as ScoreFormulaConfig["conversations"]["pointsByCount"];
                    pointsByCount[index] = next;
                    setDraft({
                      ...draft,
                      conversations: {
                        ...draft.conversations,
                        pointsByCount,
                      },
                    });
                  }}
                />
              ))}
              <NumberField
                id="conv-half"
                label="Half-life days"
                value={draft.conversations.halfLifeDays}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    conversations: {
                      ...draft.conversations,
                      halfLifeDays: value,
                    },
                  })
                }
              />
              <NumberField
                id="conv-max-age"
                label="Max age days"
                value={draft.conversations.maxAgeDays}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    conversations: {
                      ...draft.conversations,
                      maxAgeDays: value,
                    },
                  })
                }
              />
            </Section>
            <Section title="Application">
              <NumberField
                id="app-yes"
                label="Completed"
                value={draft.application.completed}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    application: { ...draft.application, completed: value },
                  })
                }
              />
              <NumberField
                id="app-no"
                label="Not completed"
                value={draft.application.notCompleted}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    application: {
                      ...draft.application,
                      notCompleted: value,
                    },
                  })
                }
              />
            </Section>
            <Section title="Replies">
              {draft.replies.pointsByCount.map((value, index) => (
                <NumberField
                  key={`reply-${index}`}
                  id={`reply-${index}`}
                  label={`Count ${index}`}
                  value={value}
                  onChange={(next) => {
                    const pointsByCount = [
                      ...draft.replies.pointsByCount,
                    ] as ScoreFormulaConfig["replies"]["pointsByCount"];
                    pointsByCount[index] = next;
                    setDraft({
                      ...draft,
                      replies: { ...draft.replies, pointsByCount },
                    });
                  }}
                />
              ))}
              <NumberField
                id="reply-half"
                label="Half-life days"
                value={draft.replies.halfLifeDays}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    replies: { ...draft.replies, halfLifeDays: value },
                  })
                }
              />
              <NumberField
                id="reply-max-age"
                label="Max age days"
                value={draft.replies.maxAgeDays}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    replies: { ...draft.replies, maxAgeDays: value },
                  })
                }
              />
            </Section>
            <Section title="Qualification">
              <NumberField
                id="fit-yes"
                label="Fit yes"
                value={draft.qualification.fitYes}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    qualification: { ...draft.qualification, fitYes: value },
                  })
                }
              />
              <NumberField
                id="fit-no"
                label="Fit no"
                value={draft.qualification.fitNo}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    qualification: { ...draft.qualification, fitNo: value },
                  })
                }
              />
              <NumberField
                id="interest-match"
                label="Interest match"
                value={draft.qualification.interestMatch}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    qualification: {
                      ...draft.qualification,
                      interestMatch: value,
                    },
                  })
                }
              />
              <NumberField
                id="interest-other"
                label="Interest other"
                value={draft.qualification.interestOther}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    qualification: {
                      ...draft.qualification,
                      interestOther: value,
                    },
                  })
                }
              />
              {(
                [
                  "incubator",
                  "capital_raising",
                  "recruitment",
                  "allocation",
                ] as const
              ).map((track) => (
                <div
                  key={track}
                  className="flex items-center justify-between gap-3"
                >
                  <Label
                    htmlFor={`track-${track}`}
                    className="text-xs text-muted-foreground"
                  >
                    {PROGRAM_TRACK_LABELS[track]} match
                  </Label>
                  <select
                    id={`track-${track}`}
                    className="h-8 w-48 rounded-lg border border-input bg-background px-2 text-sm"
                    value={draft.qualification.interestByTrack[track]}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        qualification: {
                          ...draft.qualification,
                          interestByTrack: {
                            ...draft.qualification.interestByTrack,
                            [track]: event.target
                              .value as (typeof INTERESTS)[number],
                          },
                        },
                      })
                    }
                  >
                    {INTERESTS.map((interest) => (
                      <option key={interest} value={interest}>
                        {interest}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </Section>
            <Section title="Extracted">
              {(
                [
                  "maxContribution",
                  "statedProgramFee",
                  "programFitYes",
                  "timelineNow",
                  "timelineThisQuarter",
                ] as const
              ).map((key) => (
                <NumberField
                  key={key}
                  id={`ext-${key}`}
                  label={key}
                  value={draft.extracted[key]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      extracted: { ...draft.extracted, [key]: value },
                    })
                  }
                />
              ))}
            </Section>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void previewConfig()}
            >
              Preview
            </Button>
            <Button
              type="button"
              disabled={busy !== null}
              onClick={() => void saveConfig()}
            >
              Save new version
            </Button>
          </div>

          {preview ? (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">Replay</h2>
              <p className="text-sm">
                {preview.campaignChanges} of {preview.total} contacts would
                change campaigns.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border">
                  <p className="border-b px-3 py-2 text-xs text-muted-foreground">
                    Before
                  </p>
                  <ul className="divide-y">
                    {BUCKETS.map((bucket) => (
                      <li
                        key={`before-${bucket}`}
                        className="flex justify-between px-3 py-2 text-sm"
                      >
                        <span>{LEAD_TEMP_LABELS[bucket]}</span>
                        <span className="tabular-nums">
                          {preview.before[bucket]}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border">
                  <p className="border-b px-3 py-2 text-xs text-muted-foreground">
                    After
                  </p>
                  <ul className="divide-y">
                    {BUCKETS.map((bucket) => (
                      <li
                        key={`after-${bucket}`}
                        className="flex justify-between px-3 py-2 text-sm"
                      >
                        <span>{LEAD_TEMP_LABELS[bucket]}</span>
                        <span className="tabular-nums">
                          {preview.after[bucket]}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Loading scoring…</p>
      )}
    </div>
  );
}
