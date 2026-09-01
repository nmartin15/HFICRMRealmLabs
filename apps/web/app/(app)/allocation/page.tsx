"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AllocationBoardCard,
  AllocationBoardResponse,
  AllocationClosedStage,
  AllocationOpenStage,
} from "@realm-labs/contracts";
import {
  ALLOCATION_CLOSED_STAGES,
  ALLOCATION_OPEN_STAGES,
  ALLOCATION_STAGE_LABELS,
  BUDGET_QUALIFIED_LABELS,
  TASK_KIND_LABELS,
  personDisplayName,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { isTypingTarget } from "@/hooks/use-list-navigation";
import { ApplicantDialog } from "@/components/applicant-dialog";
import { DecisionDialog } from "@/components/decision-dialog";
import { LeadTempDot } from "@/components/lead-temp-dot";
import { NoteDialog } from "@/components/note-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ClosedFilter = "all" | AllocationClosedStage;

export default function AllocationBoardPage() {
  const router = useRouter();
  const [board, setBoard] = useState<AllocationBoardResponse | null>(null);
  const [error, setError] = useState("");
  const [columnIndex, setColumnIndex] = useState(0);
  const [cardIndex, setCardIndex] = useState(0);
  const [menuCardId, setMenuCardId] = useState<string | null>(null);
  const [decisionCard, setDecisionCard] = useState<AllocationBoardCard | null>(
    null,
  );
  const [noteCard, setNoteCard] = useState<AllocationBoardCard | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const [closedFilter, setClosedFilter] = useState<ClosedFilter>("all");

  const load = useCallback(async () => {
    const data = await api<AllocationBoardResponse>("/allocation");
    setBoard(data);
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load board");
    });
  }, [load]);

  const columns = useMemo(() => {
    if (!board) {
      return ALLOCATION_OPEN_STAGES.map((stage) => ({
        stage,
        cards: [] as AllocationBoardCard[],
      }));
    }
    return ALLOCATION_OPEN_STAGES.map((stage) => ({
      stage,
      cards: board.columns[stage],
    }));
  }, [board]);

  const focusedColumn = columns[columnIndex];
  const focusedCard = focusedColumn?.cards[cardIndex] ?? null;

  useEffect(() => {
    const cards = columns[columnIndex]?.cards ?? [];
    setCardIndex((current) => {
      if (cards.length === 0) {
        return 0;
      }
      return Math.min(current, cards.length - 1);
    });
  }, [columnIndex, columns]);

  const dialogOpen = Boolean(decisionCard || noteCard || createOpen);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (dialogOpen || isTypingTarget(event.target)) {
        return;
      }
      if (!focusedColumn) {
        return;
      }
      if (event.key === "j") {
        event.preventDefault();
        if (focusedColumn.cards.length === 0) {
          return;
        }
        setCardIndex((current) =>
          Math.min(focusedColumn.cards.length - 1, current + 1),
        );
      }
      if (event.key === "k") {
        event.preventDefault();
        if (focusedColumn.cards.length === 0) {
          return;
        }
        setCardIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === "h") {
        event.preventDefault();
        setColumnIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === "l") {
        event.preventDefault();
        setColumnIndex((current) =>
          Math.min(ALLOCATION_OPEN_STAGES.length - 1, current + 1),
        );
      }
      if (event.key === "Enter" && focusedCard) {
        event.preventDefault();
        router.push(`/people/${focusedCard.person.id}`);
      }
      if (event.key === "d" && focusedCard?.card.stage === "decision") {
        event.preventDefault();
        setDecisionCard(focusedCard);
      }
      if (event.key === "n" && focusedCard) {
        event.preventDefault();
        setNoteCard(focusedCard);
      }
      if (event.key === "c") {
        event.preventDefault();
        setCreateOpen(true);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, focusedCard, focusedColumn, router]);

  async function moveCard(cardId: string, stage: AllocationOpenStage) {
    setError("");
    const current = board
      ? ALLOCATION_OPEN_STAGES.flatMap((openStage) => board.columns[openStage])
          .concat(board.closed)
          .find((item) => item.card.id === cardId)
      : undefined;
    if (current?.card.stage === stage) {
      return;
    }
    try {
      await api(`/allocation/${cardId}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ stage }),
      });
      const next = await api<AllocationBoardResponse>("/allocation");
      setBoard(next);
      const nextColumn = ALLOCATION_OPEN_STAGES.indexOf(stage);
      setColumnIndex(nextColumn);
      const idx = next.columns[stage].findIndex((item) => item.card.id === cardId);
      setCardIndex(idx < 0 ? 0 : idx);
      if (stage === "decision") {
        const card = next.columns.decision.find((item) => item.card.id === cardId);
        if (card) {
          setDecisionCard(card);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move card");
    }
  }

  async function sendAppLink(card: AllocationBoardCard) {
    setError("");
    setMenuCardId(null);
    try {
      await api(`/allocation/${card.card.id}/send-app-link`, {
        method: "POST",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send app link");
    }
  }

  const closedCards = (board?.closed ?? []).filter((item) =>
    closedFilter === "all" ? true : item.card.stage === closedFilter,
  );

  if (!board && !error) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Allocation</h1>
          <p className="text-xs text-muted-foreground">
            j/k cards · h/l columns · enter record · d decision · n note · c new
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          New applicant
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-4">
        {columns.map((column, index) => (
          <section
            key={column.stage}
            className={cn(
              "min-h-[50vh] rounded-lg border border-border/70 bg-card/50 p-2",
              index === columnIndex && "border-primary/50",
            )}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const cardId = event.dataTransfer.getData("text/plain");
              if (cardId) {
                void moveCard(cardId, column.stage);
              }
            }}
          >
            <header className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="text-sm font-medium">
                {ALLOCATION_STAGE_LABELS[column.stage]}
              </h2>
              <span className="text-xs text-muted-foreground">
                {column.cards.length}
              </span>
            </header>
            <ul className="space-y-2">
              {column.cards.map((card, cardIdx) => (
                <AllocationCardView
                  key={card.card.id}
                  card={card}
                  focused={index === columnIndex && cardIdx === cardIndex}
                  menuOpen={menuCardId === card.card.id}
                  onFocus={() => {
                    setColumnIndex(index);
                    setCardIndex(cardIdx);
                  }}
                  onOpen={() => router.push(`/people/${card.person.id}`)}
                  onToggleMenu={() =>
                    setMenuCardId((current) =>
                      current === card.card.id ? null : card.card.id,
                    )
                  }
                  onSendAppLink={() => void sendAppLink(card)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <details
        open={closedOpen}
        onToggle={(event) =>
          setClosedOpen((event.target as HTMLDetailsElement).open)
        }
        className="rounded-lg border"
      >
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          Closed ({board?.closed.length ?? 0})
        </summary>
        <div className="space-y-3 border-t px-3 py-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status</span>
            <select
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              value={closedFilter}
              onChange={(event) =>
                setClosedFilter(event.target.value as ClosedFilter)
              }
            >
              <option value="all">All</option>
              {ALLOCATION_CLOSED_STAGES.filter((stage) => stage !== "nurture").map(
                (stage) => (
                  <option key={stage} value={stage}>
                    {ALLOCATION_STAGE_LABELS[stage]}
                  </option>
                ),
              )}
            </select>
          </label>
          {closedCards.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {closedCards.map((card) => (
                <li key={card.card.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg border bg-card p-2 text-left text-sm"
                    onClick={() => router.push(`/people/${card.person.id}`)}
                  >
                    <p className="font-medium">
                      {personDisplayName(card.person)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ALLOCATION_STAGE_LABELS[card.card.stage]}
                      {card.person.company ? ` · ${card.person.company}` : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <ApplicantDialog
        open={createOpen}
        pipeline="allocation"
        onClose={() => setCreateOpen(false)}
        onCreated={async (created) => {
          const next = await api<AllocationBoardResponse>("/allocation");
          setBoard(next);
          const idx = next.columns.applied.findIndex(
            (item) => item.card.id === created.cardId,
          );
          setColumnIndex(0);
          setCardIndex(idx < 0 ? 0 : idx);
        }}
      />
      <DecisionDialog
        open={Boolean(decisionCard)}
        personName={
          decisionCard ? personDisplayName(decisionCard.person) : ""
        }
        onClose={() => setDecisionCard(null)}
        onSubmit={async (body) => {
          if (!decisionCard) {
            return;
          }
          await api(`/allocation/${decisionCard.card.id}/decide`, {
            method: "POST",
            body: JSON.stringify(body),
          });
          await load();
        }}
      />
      <NoteDialog
        open={Boolean(noteCard)}
        personName={noteCard ? personDisplayName(noteCard.person) : ""}
        onClose={() => setNoteCard(null)}
        onSave={async (text) => {
          if (!noteCard) {
            return;
          }
          await api(`/people/${noteCard.person.id}/notes`, {
            method: "POST",
            body: JSON.stringify({ text }),
          });
        }}
      />
    </div>
  );
}

function AllocationCardView({
  card,
  focused,
  menuOpen,
  onFocus,
  onOpen,
  onToggleMenu,
  onSendAppLink,
}: {
  card: AllocationBoardCard;
  focused: boolean;
  menuOpen: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onToggleMenu: () => void;
  onSendAppLink: () => void;
}) {
  const showSend = card.card.stage === "contacted";

  return (
    <li>
      <article
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", card.card.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onClick={onFocus}
        onDoubleClick={onOpen}
        className={cn(
          "rounded-lg border bg-card p-2 text-sm",
          focused && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            className="text-left font-medium"
            onClick={onOpen}
          >
            {personDisplayName(card.person)}
          </button>
          {showSend ? (
            <div className="relative">
              <button
                type="button"
                className="px-1 text-muted-foreground"
                aria-label="Card menu"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleMenu();
                }}
              >
                ⋯
              </button>
              {menuOpen ? (
                <div className="absolute right-0 z-10 mt-1 w-52 rounded-md border bg-background p-1 shadow">
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSendAppLink();
                    }}
                  >
                    Send app link without call
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {card.person.company ?? "No company"}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <LeadTempDot temp={card.person.leadTemp} />
          <span className="rounded-full border px-1.5 py-0.5">
            {BUDGET_QUALIFIED_LABELS[card.person.budgetQualified]}
          </span>
          <span className="text-muted-foreground">{card.daysInStage}d</span>
          {card.nextTaskAt ? (
            <span className="text-muted-foreground">
              {card.nextTaskKind
                ? `${TASK_KIND_LABELS[card.nextTaskKind]} · `
                : ""}
              next {formatDate(card.nextTaskAt)}
            </span>
          ) : null}
        </div>
      </article>
    </li>
  );
}
