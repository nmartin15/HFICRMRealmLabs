import { hexEqual, hmacSha256Hex } from "./secrets.js";

const DEFAULT_TOLERANCE_SECONDS = 300;

export type StripeSignatureResult =
  | { ok: true; timestamp: number }
  | { ok: false; code: "MISSING" | "INVALID" | "TIMESTAMP" };

function parseStripeSignatureHeader(header: string): {
  timestamp: string | null;
  signatures: string[];
} {
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (key === "t") {
      timestamp = value;
    } else if (key === "v1") {
      signatures.push(value);
    }
  }
  return { timestamp, signatures };
}

export function verifyStripeSignature(input: {
  payload: string;
  header: string | undefined;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}): StripeSignatureResult {
  if (!input.header || input.secret.length === 0) {
    return { ok: false, code: "MISSING" };
  }

  const parsed = parseStripeSignatureHeader(input.header);
  if (!parsed.timestamp || parsed.signatures.length === 0) {
    return { ok: false, code: "INVALID" };
  }

  const timestamp = Number(parsed.timestamp);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, code: "INVALID" };
  }

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    return { ok: false, code: "TIMESTAMP" };
  }

  const expected = hmacSha256Hex(input.secret, `${timestamp}.${input.payload}`);
  const matched = parsed.signatures.some((signature) =>
    hexEqual(signature, expected),
  );
  if (!matched) {
    return { ok: false, code: "INVALID" };
  }
  return { ok: true, timestamp };
}
