import { beforeEach, describe, expect, it, vi } from "vitest";

const { webhookOps, currentReason } = vi.hoisted(() => ({
  webhookOps: [] as string[],
  currentReason: { value: null as string | null },
}));

vi.mock("./suppression.js", () => ({
  writeSuppression: async () => {
    webhookOps.push("suppress");
  },
  suppressionReasonForEmail: async () => currentReason.value,
}));

const { applyPostmarkWebhook } = await import("./postmark-events.js");

const complaintBody = {
  RecordType: "SpamComplaint",
  Email: "ada@example.com",
  MessageID: "m-complaint",
};

function selectFrom(rows: unknown[]) {
  const limited = {
    limit: async () => rows,
  };
  return {
    from: () => ({
      where: () => limited,
      innerJoin: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  };
}

function dbWithSelects(eventRows: unknown[]) {
  let calls = 0;
  return {
    select: () => {
      const call = calls;
      calls += 1;
      if (call === 0) {
        return selectFrom(eventRows);
      }
      return selectFrom([]);
    },
    transaction: async (fn: (tx: {
      insert: (table: unknown) => { values: (row: unknown) => Promise<void> };
    }) => Promise<void>) => {
      webhookOps.push("begin");
      await fn({
        insert: () => ({
          values: async () => {
            webhookOps.push("insert");
          },
        }),
      });
      webhookOps.push("commit");
    },
  };
}

describe("applyPostmarkWebhook", () => {
  beforeEach(() => {
    webhookOps.length = 0;
    currentReason.value = null;
  });

  it("inserts the event and the tombstone in one transaction", async () => {
    const result = await applyPostmarkWebhook(dbWithSelects([]) as never, {
      body: complaintBody,
      emailHashKey: "ab".repeat(32),
      traceHeader: "trace-1",
    });

    expect(result).toEqual({ ok: true });
    expect(webhookOps).toEqual(["begin", "insert", "suppress", "commit"]);
  });

  it("does not treat a suppression failure as a duplicate", async () => {
    const db = {
      select: () => selectFrom([]),
      transaction: async () => {
        throw new Error("suppression failed");
      },
    };
    await expect(
      applyPostmarkWebhook(db as never, {
        body: {
          RecordType: "Bounce",
          Type: "HardBounce",
          Email: "ada@example.com",
          MessageID: "m-bounce",
        },
        emailHashKey: "ab".repeat(32),
        traceHeader: undefined,
      }),
    ).rejects.toThrow("suppression failed");
  });

  it("writes a tombstone when a duplicate complaint has no suppression row", async () => {
    const result = await applyPostmarkWebhook(
      dbWithSelects([{ id: "already-recorded" }]) as never,
      {
        body: complaintBody,
        emailHashKey: "ab".repeat(32),
        traceHeader: "trace-1",
      },
    );
    expect(result).toEqual({ ok: true, duplicate: true });
    expect(webhookOps).toEqual(["suppress"]);
  });

  it("does not re-write when a duplicate complaint already has a block-all tombstone", async () => {
    currentReason.value = "unsubscribed";
    const result = await applyPostmarkWebhook(
      dbWithSelects([{ id: "already-recorded" }]) as never,
      {
        body: complaintBody,
        emailHashKey: "ab".repeat(32),
        traceHeader: "trace-1",
      },
    );
    expect(result).toEqual({ ok: true, duplicate: true });
    expect(webhookOps).toEqual([]);
  });

  it("upgrades a rejected tombstone when a duplicate complaint arrives", async () => {
    currentReason.value = "rejected";
    const result = await applyPostmarkWebhook(
      dbWithSelects([{ id: "already-recorded" }]) as never,
      {
        body: complaintBody,
        emailHashKey: "ab".repeat(32),
        traceHeader: "trace-1",
      },
    );
    expect(result).toEqual({ ok: true, duplicate: true });
    expect(webhookOps).toEqual(["suppress"]);
  });

  it("re-checks the tombstone after a unique-violation race", async () => {
    const db = {
      select: () => selectFrom([]),
      transaction: async () => {
        webhookOps.push("begin");
        const error = new Error("duplicate key") as Error & { code: string };
        error.code = "23505";
        throw error;
      },
    };
    const result = await applyPostmarkWebhook(db as never, {
      body: complaintBody,
      emailHashKey: "ab".repeat(32),
      traceHeader: "trace-1",
    });
    expect(result).toEqual({ ok: true, duplicate: true });
    expect(webhookOps).toEqual(["begin", "suppress"]);
  });
});
