import { canonicalEmail } from "@realm-labs/contracts";
import { persistEmailSuppression } from "@realm-labs/db";
import { describe, expect, it } from "vitest";

const KEY = "ab".repeat(32);
const PERSON = "11111111-1111-4111-8111-111111111111";

function persistDb() {
  const inserted: Record<string, unknown>[] = [];
  return {
    inserted,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserted.push(row);
        return Object.assign(Promise.resolve([{ id: "sup-1" }]), {
          returning: async () => [{ id: "sup-1" }],
        });
      },
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
    delete: () => ({
      where: async () => undefined,
    }),
  };
}

describe("persistEmailSuppression", () => {
  it("always stores canonical email on the event so audit survives purge", async () => {
    const db = persistDb();
    await persistEmailSuppression(db as never, {
      email: "Ada+Jobs@Example.COM",
      keyHex: KEY,
      reason: "unsubscribed",
      source: "gmail",
      occurredAt: new Date("2026-09-12T18:00:00.000Z"),
      createdBy: PERSON,
      actorEmail: "nathan@realmlabs.co",
      personId: PERSON,
      payload: { excerpt: "please unsubscribe", extractor: "test" },
    });
    const event = db.inserted.find((row) => {
      const payload = row.payload;
      return Boolean(
        payload &&
          typeof payload === "object" &&
          "excerpt" in payload,
      );
    });
    expect(event).toBeDefined();
    const payload = event?.payload as { email: string; excerpt: string };
    expect(payload.email).toBe(canonicalEmail("Ada+Jobs@Example.COM"));
    expect(payload.email).toBe("ada@example.com");
  });
});
