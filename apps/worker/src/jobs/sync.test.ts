import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "sync.ts"),
  "utf8",
);

describe("gmail sync job", () => {
  it("drops unmatched mail and never dumps the whole mailbox by date", () => {
    expect(source).toContain("deleteUnmatchedEmailThreads");
    expect(source).toContain("shouldIngestGmailThread");
    expect(source).not.toContain("newer_than:");
    expect(source).not.toContain("personId: person?.id ?? null");
  });

  it("checkpoints historyId captured at the start of the run", () => {
    expect(source).toContain("gmailHistoryIdToPersist");
    expect(source).toContain("users.getProfile");
    expect(source).not.toMatch(
      /markSyncOk\(db, mailbox, profile\.historyId \?\? null\)/,
    );
  });

  it("does not treat a missing historyId as a finished Gmail pass", () => {
    expect(source).not.toContain(
      "historyProcessingComplete = !connection.gmailHistoryId",
    );
    expect(source).toContain("let historyProcessingComplete = false;");
  });

  it("does not let calendar success clear Gmail lastError or lastSyncedAt", () => {
    expect(source).not.toMatch(
      /lastError: null, lastSyncedAt: new Date\(\)/,
    );
  });

  it("logs people and skip counts so a cloud miss can be diagnosed", () => {
    expect(source).toContain("gmail.sync ${mailbox} people=");
    expect(source).toContain("listContactThreadIds");
  });
});
