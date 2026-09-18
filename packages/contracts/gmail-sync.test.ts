import { describe, expect, it } from "vitest";
import {
  GMAIL_QUOTA_PAUSED_MESSAGE,
  gmailHistoryChangedThreadIds,
  gmailHistoryIdToPersist,
  gmailSyncPlan,
  gmailSyncShouldPersistHistoryId,
  gmailThreadIdsToSkip,
  shouldProcessGmailThreadId,
} from "./gmail-sync";

describe("gmail sync plan", () => {
  it("resumes a first contact backfill by skipping threads already stored", () => {
    expect(
      gmailSyncPlan({
        storedHistoryId: null,
        lastError: null,
        historyStale: false,
      }),
    ).toEqual({
      readHistory: false,
      contactBackfill: true,
      skipStoredThreads: true,
    });
  });

  it("re-fetches stored threads when history is stale so new replies are not dropped", () => {
    expect(
      gmailSyncPlan({
        storedHistoryId: "100",
        lastError: null,
        historyStale: true,
      }),
    ).toEqual({
      readHistory: false,
      contactBackfill: true,
      skipStoredThreads: false,
    });
  });

  it("treats a sticky Gmail 404 as stale history so the next cloud run backfills", () => {
    expect(
      gmailSyncPlan({
        storedHistoryId: "100",
        lastError: "Requested entity was not found.",
        historyStale: false,
      }),
    ).toEqual({
      readHistory: false,
      contactBackfill: true,
      skipStoredThreads: false,
    });
  });

  it("keeps history incremental plus remaining backfill after a quota pause", () => {
    expect(
      gmailSyncPlan({
        storedHistoryId: "100",
        lastError: GMAIL_QUOTA_PAUSED_MESSAGE,
        historyStale: false,
      }),
    ).toEqual({
      readHistory: true,
      contactBackfill: true,
      skipStoredThreads: true,
    });
  });

  it("uses history only once backfill has finished without quota pressure", () => {
    expect(
      gmailSyncPlan({
        storedHistoryId: "100",
        lastError: null,
        historyStale: false,
      }),
    ).toEqual({
      readHistory: true,
      contactBackfill: false,
      skipStoredThreads: false,
    });
  });
});

describe("gmail history checkpoint", () => {
  it("stores the historyId captured before processing, not a later profile id", () => {
    expect(
      gmailHistoryIdToPersist({
        capturedAtStart: "10",
        laterProfileHistoryId: "99",
      }),
    ).toBe("10");
  });

  it("does not advance historyId when quota pauses mid-history processing", () => {
    expect(
      gmailSyncShouldPersistHistoryId({
        quotaPaused: true,
        historyProcessingComplete: false,
      }),
    ).toBe(false);
  });

  it("can checkpoint after history is drained so a later quota pause still catches new mail", () => {
    expect(
      gmailSyncShouldPersistHistoryId({
        quotaPaused: true,
        historyProcessingComplete: true,
      }),
    ).toBe(true);
  });
});

describe("gmail thread skip and history ids", () => {
  it("skips only threads that already have messages, not unmatched shells", () => {
    expect([
      ...gmailThreadIdsToSkip({
        skipStoredThreads: true,
        stored: [
          { gmailThreadId: "has-mail", personId: "p1", hasMessage: true },
          { gmailThreadId: "unmatched", personId: null, hasMessage: false },
          { gmailThreadId: "empty-match", personId: "p2", hasMessage: false },
        ],
      }),
    ]).toEqual(["has-mail"]);
  });

  it("never skips a thread that history reported as changed", () => {
    expect(
      shouldProcessGmailThreadId({
        threadId: "t1",
        historyThreadIds: new Set(["t1"]),
        skipThreadIds: new Set(["t1"]),
      }),
    ).toBe(true);
    expect(
      shouldProcessGmailThreadId({
        threadId: "t2",
        historyThreadIds: new Set(),
        skipThreadIds: new Set(["t2"]),
      }),
    ).toBe(false);
  });

  it("collects thread ids from messagesAdded and the messages fallback", () => {
    expect(
      gmailHistoryChangedThreadIds([
        {
          messagesAdded: [{ message: { threadId: "a" } }],
          messages: [{ threadId: "b" }],
        },
        {
          messagesAdded: [],
          messages: [{ threadId: "a" }],
        },
      ]),
    ).toEqual(["a", "b"]);
  });
});
