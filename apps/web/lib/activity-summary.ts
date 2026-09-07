import type { Activity, User } from "@realm-labs/contracts";
import { describeTaskActivity } from "@realm-labs/contracts";

export function activityActorLabel(
  activity: Activity,
  users: Pick<User, "id" | "name">[],
): string {
  const match = users.find((user) => user.id === activity.userId);
  if (match) {
    return match.name;
  }
  const who = activity.payload.who;
  if (who && typeof who === "object" && who !== null && "email" in who) {
    const email = who.email;
    if (typeof email === "string" && email.trim()) {
      return email;
    }
  }
  return "Unknown";
}

export function activitySummary(activity: Activity): string {
  const described = describeTaskActivity(activity.payload);
  if (described) {
    return described;
  }

  if (activity.type === "note") {
    const after = activity.payload.after;
    if (after && typeof after === "object" && after !== null && "text" in after) {
      const text = after.text;
      if (typeof text === "string" && text.trim()) {
        return text;
      }
    }
  }

  if (activity.type === "import") {
    const after = activity.payload.after;
    if (after && typeof after === "object" && after !== null && "filename" in after) {
      const filename = after.filename;
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
