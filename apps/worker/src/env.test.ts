import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5433/realm_labs_crm",
  TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  EMAIL_HASH_KEY: "b".repeat(64),
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
};

describe("loadEnv", () => {
  it("refuses POSTMARK_SEND_ENABLED without an alert webhook", () => {
    expect(() =>
      loadEnv({ ...base, POSTMARK_SEND_ENABLED: "true" }),
    ).toThrow(/ALERT_WEBHOOK_URL/);
    expect(
      loadEnv({
        ...base,
        POSTMARK_SEND_ENABLED: "true",
        ALERT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/X",
      }).POSTMARK_SEND_ENABLED,
    ).toBe(true);
    expect(loadEnv(base).POSTMARK_SEND_ENABLED).toBe(false);
  });
});
