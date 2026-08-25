import { describe, expect, it } from "vitest";
import {
  canMoveAllocationStage,
  canSendAppLinkWithoutCall,
  currentBoardBadge,
  daysInStage,
  isAllocationClosedStage,
  isAllocationOpenStage,
  stageEnteredAtIso,
} from "./allocation";

describe("allocation open vs closed stages", () => {
  it("treats Applied through Decision as open columns", () => {
    expect(isAllocationOpenStage("applied")).toBe(true);
    expect(isAllocationOpenStage("contacted")).toBe(true);
    expect(isAllocationOpenStage("in_conversation")).toBe(true);
    expect(isAllocationOpenStage("decision")).toBe(true);
    expect(isAllocationOpenStage("allocated")).toBe(false);
  });

  it("treats Allocated, Nurture, and Passed as closed", () => {
    expect(isAllocationClosedStage("allocated")).toBe(true);
    expect(isAllocationClosedStage("nurture")).toBe(true);
    expect(isAllocationClosedStage("passed")).toBe(true);
    expect(isAllocationClosedStage("decision")).toBe(false);
  });
});

describe("allocation stage moves", () => {
  it("allows drag between the four open columns", () => {
    expect(canMoveAllocationStage("applied", "contacted")).toBe(true);
    expect(canMoveAllocationStage("contacted", "decision")).toBe(true);
    expect(canMoveAllocationStage("decision", "applied")).toBe(true);
  });

  it("rejects moves into or out of closed statuses", () => {
    expect(canMoveAllocationStage("applied", "passed")).toBe(false);
    expect(canMoveAllocationStage("allocated", "applied")).toBe(false);
    expect(canMoveAllocationStage("nurture", "decision")).toBe(false);
  });
});

describe("send app link without call", () => {
  it("is only available from Contacted", () => {
    expect(canSendAppLinkWithoutCall("contacted")).toBe(true);
    expect(canSendAppLinkWithoutCall("applied")).toBe(false);
    expect(canSendAppLinkWithoutCall("in_conversation")).toBe(false);
    expect(canSendAppLinkWithoutCall("decision")).toBe(false);
  });
});

describe("days in stage", () => {
  it("floors elapsed time to whole days", () => {
    const entered = "2026-08-20T17:00:00.000Z";
    expect(daysInStage(entered, new Date("2026-08-20T20:00:00.000Z"))).toBe(0);
    expect(daysInStage(entered, new Date("2026-08-21T17:00:00.000Z"))).toBe(1);
    expect(daysInStage(entered, new Date("2026-08-24T17:00:00.000Z"))).toBe(4);
  });

  it("does not go negative if clocks skew", () => {
    expect(
      daysInStage("2026-08-24T18:00:00.000Z", new Date("2026-08-24T17:00:00.000Z")),
    ).toBe(0);
  });
});

describe("stage entered at", () => {
  it("uses the last matching stage_change, else card created_at", () => {
    expect(
      stageEnteredAtIso({
        cardCreatedAt: "2026-08-01T00:00:00.000Z",
        currentStage: "contacted",
        lastStageChange: {
          occurredAt: "2026-08-10T00:00:00.000Z",
          afterStage: "contacted",
        },
      }),
    ).toBe("2026-08-10T00:00:00.000Z");

    expect(
      stageEnteredAtIso({
        cardCreatedAt: "2026-08-01T00:00:00.000Z",
        currentStage: "applied",
        lastStageChange: null,
      }),
    ).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("current board badge", () => {
  it("prefers an active incubator card, including after route_incubator", () => {
    expect(
      currentBoardBadge({
        allocationStage: "decision",
        incubatorStage: "routed",
      }),
    ).toEqual({
      board: "incubator",
      stage: "routed",
      href: "/incubator",
    });
  });

  it("uses allocation when there is no incubator", () => {
    expect(
      currentBoardBadge({
        allocationStage: "in_conversation",
        incubatorStage: null,
      }),
    ).toEqual({
      board: "allocation",
      stage: "in_conversation",
      href: "/allocation",
    });
  });

  it("shows a closed allocation card when there is no incubator", () => {
    expect(
      currentBoardBadge({
        allocationStage: "passed",
        incubatorStage: null,
      }),
    ).toEqual({
      board: "allocation",
      stage: "passed",
      href: "/allocation",
    });
  });
});
