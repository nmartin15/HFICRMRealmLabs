import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { enqueueScoreRecompute } from "./queues.js";

const PERSON = "11111111-1111-4111-8111-111111111111";
const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "queues.ts"),
  "utf8",
);

describe("enqueueScoreRecompute", () => {
  it("coalesces through enqueueCoalescedScoreJob so completed jobs are replaced", () => {
    expect(source).toContain("enqueueCoalescedScoreJob");
    expect(source).toContain("scoreRecomputeJobId");
    expect(source).not.toMatch(/state === "delayed"/);
  });

  it("removes a completed job before add, otherwise add throws", async () => {
    let removed = false;
    const queues = {
      score: {
        getJob: async () => ({
          getState: async () => "completed",
          remove: async () => {
            removed = true;
          },
        }),
        add: async () => {
          if (!removed) {
            throw new Error("JobId already exists");
          }
        },
      },
    };
    await enqueueScoreRecompute(queues as never, {
      personId: PERSON,
      trigger: "inbound_email",
    });
    expect(removed).toBe(true);
  });
});
