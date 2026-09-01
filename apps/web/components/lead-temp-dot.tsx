import type { LeadTemp } from "@realm-labs/contracts";
import { LEAD_TEMP_LABELS } from "@realm-labs/contracts";
import { cn } from "@/lib/utils";

const TEMP_CLASS: Record<LeadTemp, string> = {
  hot: "bg-magenta",
  warm: "bg-canary",
  lukewarm: "bg-canary/55",
  cold: "bg-teal",
};

export function LeadTempDot({ temp }: { temp: LeadTemp | null }) {
  return (
    <span
      title={temp ? LEAD_TEMP_LABELS[temp] : "no temp"}
      className={cn(
        "inline-block size-2 rounded-full",
        temp ? TEMP_CLASS[temp] : "bg-muted-foreground/40",
      )}
    />
  );
}
