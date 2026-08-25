"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AllocationDecision,
  DecideBody,
  IncubatorTierName,
} from "@realm-labs/contracts";
import {
  defaultNurtureFollowUpAt,
  TIER_3_PRICE_RANGE,
  todayIsoInDisplayZone,
} from "@realm-labs/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TIERS: IncubatorTierName[] = ["tier_1", "tier_2", "tier_3", "tier_4"];

export function DecisionDialog({
  open,
  personName,
  initialDecision = "allocate",
  lockDecision = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  personName: string;
  initialDecision?: AllocationDecision;
  lockDecision?: boolean;
  onClose: () => void;
  onSubmit: (body: DecideBody) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [decision, setDecision] = useState<AllocationDecision>(initialDecision);
  const [passReason, setPassReason] = useState("");
  const [doNotContact, setDoNotContact] = useState(false);
  const [nurture, setNurture] = useState(true);
  const [nurtureFollowUpAt, setNurtureFollowUpAt] = useState(
    defaultNurtureFollowUpAt(todayIsoInDisplayZone(new Date())),
  );
  const [tier, setTier] = useState<IncubatorTierName | "">("");
  const [priceUsd, setPriceUsd] = useState("");
  const [routingDetail, setRoutingDetail] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    if (open && !node.open) {
      setDecision(initialDecision);
      setPassReason("");
      setDoNotContact(false);
      setNurture(true);
      setNurtureFollowUpAt(
        defaultNurtureFollowUpAt(todayIsoInDisplayZone(new Date())),
      );
      setTier("");
      setPriceUsd("");
      setRoutingDetail("");
      setError("");
      node.showModal();
    }
    if (!open && node.open) {
      node.close();
    }
  }, [initialDecision, open]);

  async function submit() {
    setError("");
    setSaving(true);
    const body: DecideBody = { decision };
    if (decision === "route_incubator") {
      if (tier) {
        body.tier = tier;
      }
      if (priceUsd.trim()) {
        body.priceUsd = Number(priceUsd);
      }
      if (routingDetail.trim()) {
        body.routingDetail = routingDetail.trim();
      }
    }
    if (decision === "pass") {
      body.doNotContact = doNotContact;
      if (passReason.trim()) {
        body.passReason = passReason.trim();
      }
      if (!doNotContact) {
        body.nurture = nurture;
        if (nurture) {
          body.nurtureFollowUpAt = nurtureFollowUpAt;
        }
      }
    }
    try {
      await onSubmit(body);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save decision");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="m-auto w-full max-w-md rounded-lg border bg-background p-4 text-foreground shadow-lg"
      onClose={onClose}
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-sm font-medium">Decision</h2>
        <p className="mt-1 text-sm text-muted-foreground">{personName}</p>

        {lockDecision ? null : (
          <div className="mt-3 space-y-1">
            <Label htmlFor="decision">Outcome</Label>
            <select
              id="decision"
              className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
              value={decision}
              onChange={(event) =>
                setDecision(event.target.value as AllocationDecision)
              }
            >
              <option value="allocate">Allocate</option>
              <option value="route_incubator">Route to Incubator</option>
              <option value="pass">Pass</option>
            </select>
          </div>
        )}

        {decision === "route_incubator" ? (
          <div className="mt-3 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="tier">Tier</Label>
              <select
                id="tier"
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
                value={tier}
                onChange={(event) =>
                  setTier(event.target.value as IncubatorTierName | "")
                }
              >
                <option value="">—</option>
                {TIERS.map((value) => (
                  <option key={value} value={value}>
                    {value.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            {tier === "tier_3" ? (
              <div className="space-y-1">
                <Label htmlFor="priceUsd">
                  Price USD ({TIER_3_PRICE_RANGE.min}–{TIER_3_PRICE_RANGE.max})
                </Label>
                <Input
                  id="priceUsd"
                  type="number"
                  min={TIER_3_PRICE_RANGE.min}
                  max={TIER_3_PRICE_RANGE.max}
                  required
                  value={priceUsd}
                  onChange={(event) => setPriceUsd(event.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="routingDetail">Routing detail</Label>
              <textarea
                id="routingDetail"
                rows={3}
                value={routingDetail}
                onChange={(event) => setRoutingDetail(event.target.value)}
                className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </div>
        ) : null}

        {decision === "pass" ? (
          <div className="mt-3 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={doNotContact}
                onChange={(event) => setDoNotContact(event.target.checked)}
              />
              Do not contact
            </label>
            {doNotContact ? (
              <div className="space-y-1">
                <Label htmlFor="passReason">Pass reason</Label>
                <Input
                  id="passReason"
                  required
                  value={passReason}
                  onChange={(event) => setPassReason(event.target.value)}
                />
              </div>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={nurture}
                    onChange={(event) => setNurture(event.target.checked)}
                  />
                  Nurture
                </label>
                {nurture ? (
                  <div className="space-y-1">
                    <Label htmlFor="nurtureFollowUpAt">Follow up</Label>
                    <Input
                      id="nurtureFollowUpAt"
                      type="date"
                      required
                      value={nurtureFollowUpAt}
                      onChange={(event) =>
                        setNurtureFollowUpAt(event.target.value)
                      }
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 text-sm text-destructive">{error}</p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            Save
          </Button>
        </div>
      </form>
    </dialog>
  );
}
