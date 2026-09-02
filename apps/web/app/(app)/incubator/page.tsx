"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  IncubatorBoardCard,
  IncubatorBoardResponse,
  IncubatorStage,
  IncubatorStageMoveBody,
} from "@realm-labs/contracts";
import {
  INCUBATOR_OPEN_STAGES,
  INCUBATOR_STAGE_LABELS,
  incubatorTierLabel,
  isIncubatorOpenStage,
  personDisplayName,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { isTypingTarget } from "@/hooks/use-list-navigation";
import { ApplicantDialog } from "@/components/applicant-dialog";
import {
  ApplicationRefDialog,
  CloseReasonDialog,
} from "@/components/incubator-dialogs";
import { NoteDialog } from "@/components/note-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PendingMove = {
  card: IncubatorBoardCard;
  stage: IncubatorStage;
};

export default function IncubatorBoardPage() {
  const router = useRouter();
  const [board, setBoard] = useState<IncubatorBoardResponse | null>(null);
  const [error, setError] = useState("");
  const [columnIndex, setColumnIndex] = useState(0);
  const [cardIndex, setCardIndex] = useState(0);
  const [menuCardId, setMenuCardId] = useState<string | null>(null);
  const [noteCard, setNoteCard] = useState<IncubatorBoardCard | null>(null);
  const [closedOpen, setClosedOpen] = useState(false);
  const [applicationRefMove, setApplicationRefMove] =
    useState<PendingMove | null>(null);
  const [closeMove, setCloseMove] = useState<PendingMove | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const data = await api<IncubatorBoardResponse>("/incubator");
    setBoard(data);
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load board");
    });
  }, [load]);

  const columns = useMemo(() => {
    if (!board) {
      return INCUBATOR_OPEN_STAGES.map((stage) => ({
        stage,
        cards: [] as IncubatorBoardCard[],
      }));
    }
    return INCUBATOR_OPEN_STAGES.map((stage) => ({
      stage,
      cards: board.columns[stage],
    }));
  }, [board]);

  const focusedColumn = columns[columnIndex];
  const focusedCard = focusedColumn?.cards[cardIndex] ?? null;
  const dialogOpen = Boolean(
    noteCard || applicationRefMove || closeMove || createOpen,
  );

  useEffect(() => {
    const cards = columns[columnIndex]?.cards ?? [];
    setCardIndex((current) => {
      if (cards.length === 0) {
        return 0;
      }
      return Math.min(current, cards.length - 1);
    });
  }, [columnIndex, columns]);

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
          Math.min(INCUBATOR_OPEN_STAGES.length - 1, current + 1),
        );
      }
      if (event.key === "Enter" && focusedCard) {
        event.preventDefault();
        router.push(`/people/${focusedCard.person.id}`);
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

  async function patchStage(
    cardId: string,
    body: IncubatorStageMoveBody,
  ): Promise<void> {
    setError("");
    try {
      await api(`/incubator/${cardId}/stage`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move card");
      throw err;
    }
    const next = await api<IncubatorBoardResponse>("/incubator");
    setBoard(next);
    if (isIncubatorOpenStage(body.stage)) {
      const nextColumn = INCUBATOR_OPEN_STAGES.indexOf(body.stage);
      setColumnIndex(nextColumn);
      const idx = next.columns[body.stage].findIndex(
        (item) => item.card.id === cardId,
      );
      setCardIndex(idx < 0 ? 0 : idx);
    }
  }

  async function requestMove(card: IncubatorBoardCard, stage: IncubatorStage) {
    setMenuCardId(null);
    if (card.card.stage === stage) {
      return;
    }
    if (stage === "applied" && !card.card.applicationRef) {
      setApplicationRefMove({ card, stage });
      return;
    }
    if (stage === "rejected") {
      setCloseMove({ card, stage });
      return;
    }
    try {
      await patchStage(card.card.id, { stage });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move card");
    }
  }

  if (!board && !error) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const pendingCard = applicationRefMove?.card ?? closeMove?.card ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Incubator</h1>
        </div>
        {board ? (
          <div className="flex items-center gap-3">
            <p className="text-sm">
              Pipeline {formatUsd(board.totals.pipelineUsd)}
              <span className="text-muted-foreground">
                {" "}
                · weighted {formatUsd(board.totals.weightedUsd)}
              </span>
            </p>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              New applicant
            </Button>
          </div>
        ) : (
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            New applicant
          </Button>
        )}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-3">
        {columns.map((column, index) => {
          const stats = board?.totals.columns[column.stage];
          return (
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
                const card = findCard(board, cardId);
                if (card) {
                  void requestMove(card, column.stage);
                }
              }}
            >
              <header className="mb-2 px-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-medium">
                    {INCUBATOR_STAGE_LABELS[column.stage]}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {stats?.count ?? column.cards.length}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatUsd(stats?.priceUsd ?? 0)}
                </p>
              </header>
              <ul className="space-y-2">
                {column.cards.map((card, cardIdx) => (
                  <IncubatorCardView
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
                    onReject={() => void requestMove(card, "rejected")}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <details
        open={closedOpen}
        onToggle={(event) =>
          setClosedOpen((event.target as HTMLDetailsElement).open)
        }
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          const cardId = event.dataTransfer.getData("text/plain");
          const card = findCard(board, cardId);
          if (card) {
            void requestMove(card, "rejected");
          }
        }}
        className="rounded-lg border"
      >
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          Rejected ({board?.closed.length ?? 0})
        </summary>
        <div className="space-y-3 border-t px-3 py-3">
          {(board?.closed.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(board?.closed ?? []).map((card) => (
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
                      {card.card.closeReason ?? "Rejected"}
                      {card.card.tier
                        ? ` · ${incubatorTierLabel(card.card.tier)}`
                        : ""}
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
        pipeline="incubator"
        onClose={() => setCreateOpen(false)}
        onCreated={async (created) => {
          const next = await api<IncubatorBoardResponse>("/incubator");
          setBoard(next);
          const sentIdx = next.columns.sent.findIndex(
            (item) => item.card.id === created.cardId,
          );
          const appliedIdx = next.columns.applied.findIndex(
            (item) => item.card.id === created.cardId,
          );
          if (appliedIdx >= 0) {
            setColumnIndex(INCUBATOR_OPEN_STAGES.indexOf("applied"));
            setCardIndex(appliedIdx);
          } else {
            setColumnIndex(INCUBATOR_OPEN_STAGES.indexOf("sent"));
            setCardIndex(sentIdx < 0 ? 0 : sentIdx);
          }
        }}
      />
      <ApplicationRefDialog
        open={Boolean(applicationRefMove)}
        personName={pendingCard ? personDisplayName(pendingCard.person) : ""}
        initialRef={applicationRefMove?.card.card.applicationRef ?? ""}
        onClose={() => setApplicationRefMove(null)}
        onSubmit={async (applicationRef) => {
          if (!applicationRefMove) {
            return;
          }
          await patchStage(applicationRefMove.card.card.id, {
            stage: "applied",
            applicationRef,
          });
        }}
      />
      <CloseReasonDialog
        open={Boolean(closeMove)}
        personName={pendingCard ? personDisplayName(pendingCard.person) : ""}
        onClose={() => setCloseMove(null)}
        onSubmit={async (closeReason) => {
          if (!closeMove) {
            return;
          }
          await patchStage(closeMove.card.card.id, {
            stage: "rejected",
            closeReason,
          });
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

function findCard(
  board: IncubatorBoardResponse | null,
  cardId: string,
): IncubatorBoardCard | undefined {
  if (!board || !cardId) {
    return undefined;
  }
  return INCUBATOR_OPEN_STAGES.flatMap((stage) => board.columns[stage]).find(
    (item) => item.card.id === cardId,
  );
}

function IncubatorCardView({
  card,
  focused,
  menuOpen,
  onFocus,
  onOpen,
  onToggleMenu,
  onReject,
}: {
  card: IncubatorBoardCard;
  focused: boolean;
  menuOpen: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onToggleMenu: () => void;
  onReject: () => void;
}) {
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
          "cursor-grab rounded-lg border bg-card p-2 text-sm active:cursor-grabbing",
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
              <div className="absolute right-0 z-10 mt-1 w-36 rounded-md border bg-background p-1 shadow">
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
                  onClick={(event) => {
                    event.stopPropagation();
                    onReject();
                  }}
                >
                  Reject
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {card.card.tier ? (
            <span className="rounded-full border px-1.5 py-0.5 capitalize">
              {incubatorTierLabel(card.card.tier)}
            </span>
          ) : null}
          {card.card.priceUsd !== null ? (
            <span>{formatUsd(card.card.priceUsd)}</span>
          ) : null}
          <span className="text-muted-foreground">{card.daysInStage}d</span>
        </div>
        {card.card.applicationRef ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {card.card.applicationRef}
          </p>
        ) : null}
      </article>
    </li>
  );
}
