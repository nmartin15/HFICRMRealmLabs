import {
  emailHashKeyFingerprint,
  ensureEmailHashKeyFingerprint,
} from "@realm-labs/db";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const KEY_A = "ab".repeat(32);
const KEY_B = "cd".repeat(32);

function fingerprintDb(rows: { fingerprint: string }[]) {
  const inserted: { fingerprint: string }[] = [];
  return {
    inserted,
    select: () => ({
      from: () => ({
        limit: async () => rows,
      }),
    }),
    insert: () => ({
      values: async (row: { fingerprint: string }) => {
        inserted.push(row);
      },
    }),
  };
}

describe("EMAIL_HASH_KEY fingerprint", () => {
  it("inserts the fingerprint when the table is empty", async () => {
    const db = fingerprintDb([]);
    await ensureEmailHashKeyFingerprint(db as never, KEY_A);
    expect(db.inserted).toEqual([
      { fingerprint: emailHashKeyFingerprint(KEY_A) },
    ]);
  });

  it("throws when the stored fingerprint does not match the current key", async () => {
    const db = fingerprintDb([
      { fingerprint: emailHashKeyFingerprint(KEY_A) },
    ]);
    await expect(
      ensureEmailHashKeyFingerprint(db as never, KEY_B),
    ).rejects.toThrow(/orphans every suppression tombstone/);
    expect(db.inserted).toEqual([]);
  });

  it("API and worker boot call ensureEmailHashKeyFingerprint", () => {
    const apiDbPlugin = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../plugins/db.ts"),
      "utf8",
    );
    const workerIndex = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../worker/src/index.ts",
      ),
      "utf8",
    );
    expect(apiDbPlugin).toContain("ensureEmailHashKeyFingerprint");
    expect(workerIndex).toContain("ensureEmailHashKeyFingerprint");
  });
});
