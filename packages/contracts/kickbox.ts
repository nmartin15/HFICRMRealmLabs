export const KICKBOX_RESULTS = [
  "deliverable",
  "undeliverable",
  "risky",
  "unknown",
] as const;
export type KickboxResult = (typeof KICKBOX_RESULTS)[number];

export function shouldVerifyFormIntakeEmail(input: {
  isNewPerson: boolean;
  alreadyVerified: boolean;
}): boolean {
  return input.isNewPerson && !input.alreadyVerified;
}

export function kickboxBlocksSend(result: KickboxResult | null): boolean {
  return result === "undeliverable";
}

export function parseKickboxResult(raw: string | null | undefined): KickboxResult | null {
  if (!raw) {
    return null;
  }
  const value = raw.trim().toLowerCase();
  if (
    value === "deliverable" ||
    value === "undeliverable" ||
    value === "risky" ||
    value === "unknown"
  ) {
    return value;
  }
  return null;
}
