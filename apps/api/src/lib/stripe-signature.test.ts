import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "./secrets.js";
import { verifyStripeSignature } from "./stripe-signature.js";

const SECRET = "whsec_test_secret";
const PAYLOAD = '{"id":"evt_1","type":"checkout.session.completed"}';

function headerFor(payload: string, timestamp: number, secret = SECRET): string {
  const signature = hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return `t=${timestamp},v1=${signature}`;
}

describe("verifyStripeSignature", () => {
  it("accepts a valid Stripe-Signature header", () => {
    const nowMs = 1_700_000_000_000;
    const timestamp = Math.floor(nowMs / 1000);
    expect(
      verifyStripeSignature({
        payload: PAYLOAD,
        header: headerFor(PAYLOAD, timestamp),
        secret: SECRET,
        nowMs,
      }),
    ).toEqual({ ok: true, timestamp });
  });

  it("rejects a missing or invalid signature", () => {
    expect(
      verifyStripeSignature({
        payload: PAYLOAD,
        header: undefined,
        secret: SECRET,
      }),
    ).toEqual({ ok: false, code: "MISSING" });
    expect(
      verifyStripeSignature({
        payload: PAYLOAD,
        header: headerFor(PAYLOAD, Math.floor(Date.now() / 1000), "other"),
        secret: SECRET,
      }),
    ).toEqual({ ok: false, code: "INVALID" });
  });

  it("rejects a timestamp outside the tolerance window", () => {
    const nowMs = 1_700_000_000_000;
    const old = Math.floor(nowMs / 1000) - 301;
    expect(
      verifyStripeSignature({
        payload: PAYLOAD,
        header: headerFor(PAYLOAD, old),
        secret: SECRET,
        nowMs,
      }),
    ).toEqual({ ok: false, code: "TIMESTAMP" });
  });
});
