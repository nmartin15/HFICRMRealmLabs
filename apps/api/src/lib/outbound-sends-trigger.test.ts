import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const drizzleDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/db/drizzle",
);

describe("outbound_sends_reject_suppressed", () => {
  it("latest function body rejects suppressed hashes on queued, sending, and sent rows", () => {
    const files = readdirSync(drizzleDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const bodies = files
      .map((name) => readFileSync(join(drizzleDir, name), "utf8"))
      .filter((sql) =>
        sql.includes("CREATE OR REPLACE FUNCTION outbound_sends_reject_suppressed"),
      );
    const latest = bodies.at(-1);
    expect(latest).toBeDefined();
    expect(latest).toMatch(
      /NEW\.status NOT IN \('queued', 'sending', 'sent'\)/,
    );
    expect(latest).not.toMatch(/IF NEW\.status <> 'queued' THEN/);
    expect(latest).not.toMatch(
      /IF NEW\.status NOT IN \('queued', 'sent'\) THEN/,
    );
  });
});
