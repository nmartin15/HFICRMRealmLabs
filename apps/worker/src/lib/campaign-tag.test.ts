import { describe, expect, it } from "vitest";
import { persistCampaignTag } from "./campaign-tag.js";

const WRITE_ERROR = "stale persist must not write";
const PERSON = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.com",
  programTrack: "allocation",
  doNotContact: false,
};

const stored = {
  id: "22222222-2222-4222-8222-222222222222",
  personId: PERSON.id,
  tag: "rl.v1.sales.allocation.contacted.warm",
  sequenceAction: "start",
  intensity: "warm",
  programStageKey: "allocation:contacted",
  lastSequenceStartAt: null,
  lastStartProgramStageKey: null,
  programStageStartCount: 0,
  programStageStartWindowAt: null,
  revision: 4,
  asOf: new Date("2026-09-12T18:00:00.000Z"),
};

function thenableRows(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    limit: async () => rows,
  });
}

function readDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => thenableRows([stored]),
      }),
    }),
    insert: () => {
      throw new Error(WRITE_ERROR);
    },
    update: () => {
      throw new Error(WRITE_ERROR);
    },
  };
}

describe("persistCampaignTag", () => {
  it("does not write when an older asOf arrives after a newer tag", async () => {
    await persistCampaignTag(readDb() as never, { EMAIL_HASH_KEY: "ab".repeat(32) }, {
      person: PERSON as never,
      bucket: "cold",
      suppressionReason: null,
      asOf: new Date("2026-09-12T17:00:00.000Z"),
    });
  });
});
