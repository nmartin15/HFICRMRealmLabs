import { describe, expect, it } from "vitest";
import {
  GmailQuotaPausedError,
  gmailRetryDelayMs,
  isGmailRateLimit,
  isMissingGmailEntity,
} from "./gmail-rate-limit.js";

describe("isMissingGmailEntity", () => {
  it("detects Gmail threads.get 404", () => {
    expect(
      isMissingGmailEntity({
        status: 404,
        code: 404,
        message: "Requested entity was not found.",
        errors: [{ reason: "notFound" }],
      }),
    ).toBe(true);
  });

  it("detects Gaxios-wrapped Gmail 404s used in cloud sync", () => {
    expect(
      isMissingGmailEntity({
        message: "Request failed with status code 404",
        code: "ERR_BAD_REQUEST",
        response: {
          status: 404,
          data: {
            error: {
              code: 404,
              message: "Requested entity was not found.",
              errors: [{ reason: "notFound" }],
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("ignores quota and auth failures", () => {
    expect(
      isMissingGmailEntity({
        status: 403,
        message: "Quota exceeded",
        errors: [{ reason: "rateLimitExceeded" }],
      }),
    ).toBe(false);
    expect(isMissingGmailEntity({ status: 401, message: "Invalid Credentials" })).toBe(
      false,
    );
  });
});

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
    expect(err.message).toBe("Gmail quota paused; next sync will continue");
  });
});
