import { describe, expect, it } from "vitest";
import {
  evaluateIncubatorMove,
  incubatorBoardTotals,
  incubatorPipelineValue,
  INCUBATOR_STAGE_WEIGHTS,
  isBudgetQualified,
  isIncubatorOpenStage,
  type IncubatorMoveInput,
} from "./incubator";

const base: IncubatorMoveInput = {
  from: "sent",
  to: "sent",
  budgetQualified: "unknown",
  noCallAppLink: false,
  applicationRef: null,
  tier: null,
  priceUsd: null,
};

describe("incubator open stages", () => {
  it("treats Sent, Applied, and Approved as open", () => {
    expect(isIncubatorOpenStage("sent")).toBe(true);
    expect(isIncubatorOpenStage("applied")).toBe(true);
    expect(isIncubatorOpenStage("approved")).toBe(true);
    expect(isIncubatorOpenStage("rejected")).toBe(false);
  });
});

describe("budget qualified", () => {
  it("treats light and heavy as qualified", () => {
    expect(isBudgetQualified("light")).toBe(true);
    expect(isBudgetQualified("heavy")).toBe(true);
    expect(isBudgetQualified("not_qualified")).toBe(false);
    expect(isBudgetQualified("unknown")).toBe(false);
  });
});

describe("evaluateIncubatorMove", () => {
  it("requires an application ref to move to Applied", () => {
    expect(
      evaluateIncubatorMove({ ...base, to: "applied" }),
    ).toMatchObject({ ok: false, code: "APPLICATION_REF_REQUIRED" });
  });

  it("moves to Applied with a ref", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        to: "applied",
        nextApplicationRef: "APP-9",
      }),
    ).toMatchObject({ ok: true, stage: "applied", applicationRef: "APP-9" });
  });

  it("requires a close reason to reject", () => {
    expect(
      evaluateIncubatorMove({ ...base, to: "rejected" }),
    ).toMatchObject({ ok: false, code: "CLOSE_REASON_REQUIRED" });
  });

  it("rejects with a reason", () => {
    expect(
      evaluateIncubatorMove({
        ...base,
        to: "rejected",
        closeReason: "Withdrew",
      }),
    ).toMatchObject({
      ok: true,
      stage: "rejected",
      closeReason: "Withdrew",
      closed: true,
    });
  });

  it("does not move a rejected card", () => {
    expect(
      evaluateIncubatorMove({ ...base, from: "rejected", to: "sent" }),
    ).toMatchObject({ ok: false, code: "INVALID_STAGE_MOVE" });
  });
});

describe("pipeline math", () => {
  it("weights open stages", () => {
    expect(INCUBATOR_STAGE_WEIGHTS.sent).toBe(0.25);
    const pipeline = incubatorPipelineValue([
      { stage: "sent", priceUsd: 4000 },
      { stage: "applied", priceUsd: 10000 },
      { stage: "approved", priceUsd: 20000 },
      { stage: "rejected", priceUsd: 999 },
    ]);
    expect(pipeline.total).toBe(34000);
    expect(pipeline.weighted).toBe(4000 * 0.25 + 10000 * 0.4 + 20000);
  });

  it("totals board columns", () => {
    const totals = incubatorBoardTotals({
      sent: [{ priceUsd: 4000 }],
      applied: [{ priceUsd: 10000 }],
      approved: [],
    });
    expect(totals.columns.sent).toEqual({ count: 1, priceUsd: 4000 });
    expect(totals.pipelineUsd).toBe(14000);
  });
});
