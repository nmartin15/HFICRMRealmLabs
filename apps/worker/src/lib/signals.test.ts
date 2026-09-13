import { extractedSourceFor } from "@realm-labs/contracts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { persistCalls } = vi.hoisted(() => ({
  persistCalls: [] as unknown[],
}));

vi.mock("@realm-labs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@realm-labs/db")>();
  return {
    ...actual,
    persistEmailSuppression: async (...args: unknown[]) => {
      persistCalls.push(args[1]);
    },
  };
});

const { ingestExtractedText } = await import("./signals.js");

const PERSON = "11111111-1111-4111-8111-111111111111";
const KEY = "ab".repeat(32);
const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "signals.ts"),
  "utf8",
);

describe("worker gmail opt-out", () => {
  beforeEach(() => {
    persistCalls.length = 0;
  });

  it("uses persistEmailSuppression instead of a private writer", () => {
    expect(source).toContain("persistEmailSuppression");
    expect(source).not.toContain("honorPlainLanguageOptOut");
  });

  it("passes the person email into the shared writer", async () => {
    await ingestExtractedText({} as never, {
      personId: PERSON,
      personEmail: "Ada+Jobs@Example.COM",
      keyHex: KEY,
      text: "please unsubscribe me from these emails",
      sourceType: "email_message",
      sourceEmailMessageId: PERSON,
      actor: { id: PERSON, email: "nathan@realmlabs.co" },
      occurredAt: new Date("2026-09-12T18:00:00.000Z"),
    });
    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0]).toMatchObject({
      email: "Ada+Jobs@Example.COM",
      reason: "unsubscribed",
      source: extractedSourceFor("email_message"),
      personId: PERSON,
      payload: {
        excerpt: expect.any(String) as string,
        extractor: expect.any(String) as string,
      },
    });
  });
});
