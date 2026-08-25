"use client";

import type { HandSetMeetingOutcome } from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

const OUTCOMES: { value: HandSetMeetingOutcome; label: string }[] = [
  { value: "held", label: "Held" },
  { value: "no_show", label: "No Show" },
  { value: "rescheduled", label: "Rescheduled" },
];

export function MeetingOutcomeButtons({
  meetingId,
  onUpdated,
}: {
  meetingId: string;
  onUpdated?: () => void;
}) {
  async function setOutcome(outcome: HandSetMeetingOutcome) {
    await api(`/meetings/${meetingId}`, {
      method: "PATCH",
      body: JSON.stringify({ outcome }),
    });
    onUpdated?.();
  }

  return (
    <div className="flex flex-wrap gap-1">
      {OUTCOMES.map((item) => (
        <Button
          key={item.value}
          type="button"
          size="xs"
          variant="outline"
          onClick={(event) => {
            event.stopPropagation();
            void setOutcome(item.value);
          }}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
