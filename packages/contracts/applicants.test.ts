import { describe, expect, it } from "vitest";
import { planManualApplicant } from "./applicants";

const existing = {
  id: "11111111-1111-4111-8111-111111111111",
  doNotContact: false,
  deleted: false,
  hasAllocationCard: false,
  hasIncubatorCard: false,
};

describe("planManualApplicant allocation", () => {
  it("creates an Applied card without an incubator card", () => {
    expect(
      planManualApplicant({
        programTrack: "allocation",
        name: "Ada Lovelace",
        existing: null,
      }),
    ).toMatchObject({
      ok: true,
      firstName: "Ada",
      lastName: "Lovelace",
      reusePersonId: null,
      allocationStage: "applied",
      incubatorStage: null,
      programTrack: "allocation",
    });
  });

  it("rejects a second allocation card", () => {
    expect(
      planManualApplicant({
        programTrack: "allocation",
        name: "Ada Lovelace",
        existing: { ...existing, hasAllocationCard: true },
      }),
    ).toMatchObject({
      ok: false,
      status: 409,
      code: "ALREADY_ON_ALLOCATION",
    });
  });
});

describe("planManualApplicant incubator", () => {
  it("creates a Sent card without an allocation card", () => {
    expect(
      planManualApplicant({
        programTrack: "incubator",
        name: "Grace Hopper",
        existing: null,
      }),
    ).toMatchObject({
      ok: true,
      allocationStage: null,
      incubatorStage: "sent",
      applicationRef: null,
    });
  });

  it("lands on Applied when a ref is given", () => {
    expect(
      planManualApplicant({
        programTrack: "incubator",
        name: "Grace Hopper",
        existing: null,
        applicationRef: "APP-9",
      }),
    ).toMatchObject({
      ok: true,
      incubatorStage: "applied",
      applicationRef: "APP-9",
    });
  });
});

describe("planManualApplicant other tracks", () => {
  it("creates a person without a pipeline card", () => {
    expect(
      planManualApplicant({
        programTrack: "recruitment",
        name: "Ada Lovelace",
        existing: null,
      }),
    ).toMatchObject({
      ok: true,
      allocationStage: null,
      incubatorStage: null,
      programTrack: "recruitment",
    });
  });
});

describe("planManualApplicant shared rules", () => {
  it("requires first and last name", () => {
    expect(
      planManualApplicant({
        programTrack: "allocation",
        name: "Ada",
        existing: null,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_NAME" });
  });

  it("blocks do not contact", () => {
    expect(
      planManualApplicant({
        programTrack: "incubator",
        name: "Ada Lovelace",
        existing: { ...existing, doNotContact: true },
      }),
    ).toMatchObject({ ok: false, code: "DO_NOT_CONTACT" });
  });
});
