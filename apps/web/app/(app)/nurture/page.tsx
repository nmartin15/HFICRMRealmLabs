"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AllocationBoardCard,
  DecideBody,
  NurtureListResponse,
} from "@realm-labs/contracts";
import { personDisplayName } from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  isTypingTarget,
  useListNavigation,
} from "@/hooks/use-list-navigation";
import { DecisionDialog } from "@/components/decision-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NurturePage() {
  const router = useRouter();
  const [cards, setCards] = useState<AllocationBoardCard[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [routeCard, setRouteCard] = useState<AllocationBoardCard | null>(null);

  const load = useCallback(async () => {
    const res = await api<NurtureListResponse>("/nurture");
    setCards(res.data);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load nurture");
      setLoaded(true);
    });
  }, [load]);

  const selected = useListNavigation(cards.length);
  const focused = cards[selected];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (routeCard || isTypingTarget(event.target)) {
        return;
      }
      if (event.key === "Enter" && focused) {
        event.preventDefault();
        router.push(`/people/${focused.person.id}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused, routeCard, router]);

  async function reopen(card: AllocationBoardCard) {
    setError("");
    try {
      await api(`/nurture/${card.card.id}/reopen`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reopen");
    }
  }

  async function passForGood(card: AllocationBoardCard) {
    setError("");
    try {
      await api(`/nurture/${card.card.id}/pass`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pass");
    }
  }

  async function route(body: DecideBody) {
    if (!routeCard) {
      return;
    }
    await api(`/nurture/${routeCard.card.id}/route`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    await load();
  }

  if (!loaded && !error) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!error && cards.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-medium tracking-tight">Nurture</h1>
        <p className="text-sm text-muted-foreground">No nurture cards.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-medium tracking-tight">Nurture</h1>
        <p className="text-xs text-muted-foreground">
          Sorted by follow-up. j/k to move, enter to open.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ul className="divide-y rounded-lg border">
        {cards.map((card, index) => (
          <li
            key={card.card.id}
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 px-3 py-2",
              index === selected && "bg-primary/10",
            )}
          >
            <button
              type="button"
              className="text-left text-sm"
              onClick={() => router.push(`/people/${card.person.id}`)}
            >
              <p className="font-medium">{personDisplayName(card.person)}</p>
              <p className="text-xs text-muted-foreground">
                {card.person.company ?? "No company"}
                {card.card.nurtureFollowUpAt
                  ? ` · follow up ${formatDate(card.card.nurtureFollowUpAt)}`
                  : ""}
              </p>
            </button>
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void reopen(card)}
              >
                Reopen
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRouteCard(card)}
              >
                Route to Incubator
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void passForGood(card)}
              >
                Pass for good
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <DecisionDialog
        open={Boolean(routeCard)}
        personName={routeCard ? personDisplayName(routeCard.person) : ""}
        initialDecision="route_incubator"
        lockDecision
        onClose={() => setRouteCard(null)}
        onSubmit={route}
      />
    </div>
  );
}
