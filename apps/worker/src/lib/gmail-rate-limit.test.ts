import { describe, expect, it } from "vitest";
import {
  GmailQuotaPausedError,
  gmailRetryDelayMs,
  isGmailRateLimit,
} from "./gmail-rate-limit.js";

describe("isGmailRateLimit", () => {
  it("detects 429", () => {
    expect(isGmailRateLimit({ status: 429, message: "Too Many Requests" })).toBe(
      true,
    );
  });

  it("detects Gmail quota 403", () => {
    expect(
      isGmailRateLimit({
        status: 403,
        code: 403,
        message:
          "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'",
        errors: [{ reason: "rateLimitExceeded" }],
      }),
    ).toBe(true);
  });

  it("ignores disabled-API 403", () => {
    expect(
      isGmailRateLimit({
        status: 403,
        message: "Gmail API has not been used in project 429691711118 before",
        errors: [{ reason: "accessNotConfigured" }],
      }),
    ).toBe(false);
  });
});

describe("gmailRetryDelayMs", () => {
  it("reads Retry-After seconds", () => {
    expect(
      gmailRetryDelayMs({
        response: { headers: { "retry-after": "12" } },
      }),
    ).toBe(12_000);
  });

  it("falls back to one minute", () => {
    expect(gmailRetryDelayMs(new Error("nope"))).toBe(60_000);
  });
});

describe("GmailQuotaPausedError", () => {
  it("is an Error subclass", () => {
    const err = new GmailQuotaPausedError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("GmailQuotaPausedError");
  });
});
