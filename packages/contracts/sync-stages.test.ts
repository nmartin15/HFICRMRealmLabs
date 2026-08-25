import { describe, expect, it } from "vitest";
import {
  allocationStageOnInboundReply,
  allocationStageOnMeetingCreated,
  cancelledMeetingResolution,
} from "./sync-stages";
import type { AllocationStage } from "./enums";

const stages: AllocationStage[] = [
  "applied",
  "contacted",
  "in_conversation",
  "decision",
  "allocated",
  "nurture",
  "passed",
];

describe("automatic stage moves", () => {
  it("moves Applied to Contacted on first inbound reply", () => {
    expect(allocationStageOnInboundReply("applied")).toBe("contacted");
  });

  it("does not move any other stage on inbound reply", () => {
    for (const stage of stages) {
      if (stage === "applied") {
        continue;
      }
      expect(allocationStageOnInboundReply(stage)).toBeNull();
    }
  });

  it("moves Applied or Contacted to In Conversation when a meeting is created", () => {
    expect(allocationStageOnMeetingCreated("applied")).toBe("in_conversation");
    expect(allocationStageOnMeetingCreated("contacted")).toBe(
      "in_conversation",
    );
  });

  it("does not move later stages when a meeting is created", () => {
    expect(allocationStageOnMeetingCreated("in_conversation")).toBeNull();
    expect(allocationStageOnMeetingCreated("decision")).toBeNull();
    expect(allocationStageOnMeetingCreated("allocated")).toBeNull();
    expect(allocationStageOnMeetingCreated("nurture")).toBeNull();
    expect(allocationStageOnMeetingCreated("passed")).toBeNull();
  });

  it("marks a cancelled meeting rescheduled only when a replacement exists", () => {
    expect(cancelledMeetingResolution(true)).toBe("rescheduled");
    expect(cancelledMeetingResolution(false)).toBe("needs_review");
  });
});
