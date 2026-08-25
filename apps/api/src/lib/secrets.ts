import { createHmac, timingSafeEqual } from "node:crypto";

export function secretsEqual(provided: string, expected: string): boolean {
  if (provided.length === 0 || expected.length === 0) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function hexEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
