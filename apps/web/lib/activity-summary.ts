import type { Activity } from "@realm-labs/contracts";

export function activitySummary(activity: Activity): string {
  if (activity.type === "note") {
    const after = activity.payload.after;
    if (after && typeof after === "object" && after !== null && "text" in after) {
      const text = (after as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) {
        return text;
      }
    }
  }

  if (activity.type === "import") {
    const after = activity.payload.after;
    if (after && typeof after === "object" && after !== null && "filename" in after) {
      const filename = (after as { filename?: unknown }).filename;
      if (typeof filename === "string" && filename.trim()) {
        return `Imported from ${filename}`;
      }
    }
  }

  const what = activity.payload.what;
  if (typeof what === "string" && what.trim()) {
    return what;
  }
  return activity.type.replaceAll("_", " ");
}
