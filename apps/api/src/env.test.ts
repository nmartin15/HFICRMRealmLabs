import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5433/realm_labs_crm",
  SESSION_SECRET: "dev-session-secret-change-me-32chars",
  ADMIN_EMAIL: "nathan@realmlabs.co",
  TOKEN_ENCRYPTION_KEY: "a".repeat(64),
};

describe("loadEnv stripe flag", () => {
  it("defaults STRIPE_ENABLED off", () => {
    expect(loadEnv(base).STRIPE_ENABLED).toBe(false);
    expect(loadEnv({ ...base, STRIPE_ENABLED: "false" }).STRIPE_ENABLED).toBe(
      false,
    );
    expect(loadEnv({ ...base, STRIPE_ENABLED: "true" }).STRIPE_ENABLED).toBe(
      true,
    );
  });

  it("defaults ALLOWED_HOSTED_DOMAIN to realmlabs.co", () => {
    expect(loadEnv(base).ALLOWED_HOSTED_DOMAIN).toBe("realmlabs.co");
    expect(
      loadEnv({ ...base, ALLOWED_HOSTED_DOMAIN: " RealmLabs.CO " })
        .ALLOWED_HOSTED_DOMAIN,
    ).toBe("realmlabs.co");
  });

  it("defaults RESUME_STORAGE_DIR to data/resumes", () => {
    expect(loadEnv(base).RESUME_STORAGE_DIR).toBe("data/resumes");
  });
});
