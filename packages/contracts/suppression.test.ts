import { describe, expect, it } from "vitest";
import { canonicalEmail } from "./email-matching";
import {
  PURGE_STEP_ORDER,
  blocksImportUpdate,
  blocksPersonCreate,
  isEligibleForNewsletter,
  isEligibleForSalesCampaign,
  planDoNotContactChange,
  planSuppressionWrite,
  suppressionLookupEmail,
  winningSuppressionReason,
} from "./suppression";

describe("suppression email key", () => {
  it("uses canonicalEmail so plus aliases share a tombstone", () => {
    expect(suppressionLookupEmail("Jane+Jobs@Example.COM")).toBe(
      "jane@example.com",
    );
    expect(suppressionLookupEmail("jane+jobs@example.com")).toBe(
      canonicalEmail("jane@example.com"),
    );
  });
});

describe("reason precedence", () => {
  it("lets a stronger reason replace a weaker one", () => {
    expect(winningSuppressionReason("rejected", "unsubscribed")).toBe(
      "unsubscribed",
    );
    expect(winningSuppressionReason("unsubscribed", "rejected")).toBe(
      "unsubscribed",
    );
  });

  it("last-write-wins at the same rank", () => {
    expect(winningSuppressionReason("rejected", "enrolled")).toBe("enrolled");
    expect(winningSuppressionReason("enrolled", "rejected")).toBe("rejected");
  });
});

describe("planSuppressionWrite", () => {
  it("writes the tombstone before any purge", () => {
    expect(PURGE_STEP_ORDER[0]).toBe("upsert_suppression");
    expect(PURGE_STEP_ORDER[1]).toBe("insert_suppression_event");
    expect(PURGE_STEP_ORDER.indexOf("upsert_suppression")).toBeLessThan(
      PURGE_STEP_ORDER.indexOf("delete_person_graph"),
    );

    const plan = planSuppressionWrite({
      currentReason: null,
      incomingReason: "unsubscribed",
      alreadyPurged: false,
    });
    expect(plan.upsertTombstone).toBe(true);
    expect(plan.insertEvent).toBe(true);
    expect(plan.purgePerson).toBe(true);
    expect(plan.nextReason).toBe("unsubscribed");
  });

  it("does not purge do-not-contact or already-purged rows", () => {
    expect(
      planSuppressionWrite({
        currentReason: null,
        incomingReason: "do_not_contact",
        alreadyPurged: false,
      }).purgePerson,
    ).toBe(false);
    expect(
      planSuppressionWrite({
        currentReason: "unsubscribed",
        incomingReason: "complained",
        alreadyPurged: true,
      }).purgePerson,
    ).toBe(false);
  });

  it("does not weaken an existing tombstone", () => {
    const plan = planSuppressionWrite({
      currentReason: "unsubscribed",
      incomingReason: "enrolled",
      alreadyPurged: true,
    });
    expect(plan.nextReason).toBe("unsubscribed");
    expect(plan.reasonChanged).toBe(false);
    expect(plan.insertEvent).toBe(true);
  });
});

describe("create and import blocks", () => {
  it("blocks creating any suppressed address", () => {
    expect(blocksPersonCreate("rejected")).toBe(true);
    expect(blocksPersonCreate("unsubscribed")).toBe(true);
    expect(blocksPersonCreate(null)).toBe(false);
  });

  it("blocks import updates only for purge-class and DNC", () => {
    expect(blocksImportUpdate("unsubscribed")).toBe(true);
    expect(blocksImportUpdate("do_not_contact")).toBe(true);
    expect(blocksImportUpdate("rejected")).toBe(false);
    expect(blocksImportUpdate("enrolled")).toBe(false);
    expect(blocksImportUpdate(null)).toBe(false);
  });
});

describe("campaign eligibility", () => {
  it("lets suppression win over score, stay-in-touch, and newsletter", () => {
    expect(
      isEligibleForSalesCampaign({
        suppressionReason: null,
        stayInTouch: false,
        doNotContact: false,
      }),
    ).toBe(true);
    expect(
      isEligibleForSalesCampaign({
        suppressionReason: "rejected",
        stayInTouch: false,
        doNotContact: false,
      }),
    ).toBe(false);
    expect(
      isEligibleForSalesCampaign({
        suppressionReason: null,
        stayInTouch: true,
        doNotContact: false,
      }),
    ).toBe(false);
    expect(
      isEligibleForSalesCampaign({
        suppressionReason: "enrolled",
        stayInTouch: false,
        doNotContact: false,
      }),
    ).toBe(false);
  });

  it("allows newsletter for rejected and enrolled when granted", () => {
    expect(
      isEligibleForNewsletter({
        suppressionReason: "rejected",
        newsletterGranted: true,
      }),
    ).toBe(true);
    expect(
      isEligibleForNewsletter({
        suppressionReason: "enrolled",
        newsletterGranted: true,
      }),
    ).toBe(true);
    expect(
      isEligibleForNewsletter({
        suppressionReason: "unsubscribed",
        newsletterGranted: true,
      }),
    ).toBe(false);
    expect(
      isEligibleForNewsletter({
        suppressionReason: null,
        newsletterGranted: false,
      }),
    ).toBe(false);
  });
});

describe("planDoNotContactChange", () => {
  it("writes a permanent tombstone when turning DNC on", () => {
    expect(
      planDoNotContactChange({
        currentlyDoNotContact: false,
        nextDoNotContact: true,
      }),
    ).toEqual({
      ok: true,
      writeSuppression: true,
      reason: "do_not_contact",
      setDoNotContact: true,
      clearProgramTrack: true,
    });
  });

  it("refuses to lift DNC", () => {
    expect(
      planDoNotContactChange({
        currentlyDoNotContact: true,
        nextDoNotContact: false,
      }),
    ).toMatchObject({
      ok: false,
      status: 409,
      code: "CANNOT_LIFT_SUPPRESSION",
    });
  });
});
