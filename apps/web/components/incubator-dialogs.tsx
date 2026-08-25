"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { IncubatorTierName } from "@realm-labs/contracts";
import {
  TIER_3_PRICE_RANGE,
  defaultPriceUsdForTier,
  incubatorTierLabel,
} from "@realm-labs/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TIERS: IncubatorTierName[] = ["tier_1", "tier_2", "tier_3", "tier_4"];

function DialogShell({
  open,
  title,
  personName,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  personName: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    if (open && !node.open) {
      node.showModal();
    }
    if (!open && node.open) {
      node.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="m-auto w-full max-w-md rounded-lg border bg-background p-4 text-foreground shadow-lg"
      onClose={onClose}
      onCancel={onClose}
    >
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{personName}</p>
      {children}
    </dialog>
  );
}

export function ApplicationRefDialog({
  open,
  personName,
  initialRef,
  onClose,
  onSubmit,
}: {
  open: boolean;
  personName: string;
  initialRef: string;
  onClose: () => void;
  onSubmit: (applicationRef: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialRef);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialRef);
    }
  }, [initialRef, open]);

  return (
    <DialogShell
      open={open}
      title="Application received"
      personName={personName}
      onClose={onClose}
    >
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const next = value.trim();
          if (!next || saving) {
            return;
          }
          setSaving(true);
          void onSubmit(next)
            .then(onClose)
            .finally(() => setSaving(false));
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="applicationRef">Application ref</Label>
          <Input
            id="applicationRef"
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || !value.trim()}>
            Save
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

export function OfferDialog({
  open,
  personName,
  initialTier,
  initialPriceUsd,
  onClose,
  onSubmit,
}: {
  open: boolean;
  personName: string;
  initialTier: IncubatorTierName | null;
  initialPriceUsd: number | null;
  onClose: () => void;
  onSubmit: (input: {
    tier: IncubatorTierName;
    priceUsd: number;
  }) => Promise<void>;
}) {
  const [tier, setTier] = useState<IncubatorTierName | "">(initialTier ?? "");
  const [priceUsd, setPriceUsd] = useState(
    initialPriceUsd !== null ? String(initialPriceUsd) : "",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTier(initialTier ?? "");
      setPriceUsd(initialPriceUsd !== null ? String(initialPriceUsd) : "");
    }
  }, [initialPriceUsd, initialTier, open]);

  function onTierChange(next: IncubatorTierName | "") {
    setTier(next);
    if (!next) {
      return;
    }
    if (next === "tier_3") {
      if (initialTier === "tier_3" && initialPriceUsd !== null) {
        setPriceUsd(String(initialPriceUsd));
        return;
      }
      setPriceUsd("");
      return;
    }
    const defaults = defaultPriceUsdForTier(next);
    if (defaults !== null) {
      setPriceUsd(String(defaults));
    }
  }

  return (
    <DialogShell
      open={open}
      title="Offer made"
      personName={personName}
      onClose={onClose}
    >
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!tier || saving) {
            return;
          }
          const price = Number(priceUsd);
          if (!Number.isInteger(price)) {
            return;
          }
          setSaving(true);
          void onSubmit({ tier, priceUsd: price })
            .then(onClose)
            .finally(() => setSaving(false));
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="offer-tier">Tier</Label>
          <select
            id="offer-tier"
            required
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            value={tier}
            onChange={(event) =>
              onTierChange(event.target.value as IncubatorTierName | "")
            }
          >
            <option value="">—</option>
            {TIERS.map((value) => (
              <option key={value} value={value}>
                {incubatorTierLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="offer-price">
            Price USD
            {tier === "tier_3"
              ? ` (${TIER_3_PRICE_RANGE.min}–${TIER_3_PRICE_RANGE.max})`
              : ""}
          </Label>
          <Input
            id="offer-price"
            type="number"
            required
            min={tier === "tier_3" ? TIER_3_PRICE_RANGE.min : 0}
            max={tier === "tier_3" ? TIER_3_PRICE_RANGE.max : undefined}
            value={priceUsd}
            onChange={(event) => setPriceUsd(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || !tier}>
            Confirm
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

export function PaidConfirmDialog({
  open,
  personName,
  onClose,
  onSubmit,
}: {
  open: boolean;
  personName: string;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  return (
    <DialogShell
      open={open}
      title="Mark as paid"
      personName={personName}
      onClose={onClose}
    >
      <p className="mt-3 text-sm">Confirm this person has paid.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void onSubmit()
              .then(onClose)
              .finally(() => setSaving(false));
          }}
        >
          Confirm
        </Button>
      </div>
    </DialogShell>
  );
}

export function CloseReasonDialog({
  open,
  personName,
  onClose,
  onSubmit,
}: {
  open: boolean;
  personName: string;
  onClose: () => void;
  onSubmit: (closeReason: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue("");
    }
  }, [open]);

  return (
    <DialogShell
      open={open}
      title="Close"
      personName={personName}
      onClose={onClose}
    >
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const next = value.trim();
          if (!next || saving) {
            return;
          }
          setSaving(true);
          void onSubmit(next)
            .then(onClose)
            .finally(() => setSaving(false));
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="closeReason">Close reason</Label>
          <textarea
            id="closeReason"
            required
            rows={3}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || !value.trim()}>
            Close card
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
