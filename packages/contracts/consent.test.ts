import { describe, expect, it } from "vitest";
import {
  hasNewsletterGrant,
  hasStayInTouch,
  planConsentGrant,
  planFullOptOut,
  planNewsletterWithdraw,
  planCampaignUnsubscribe,
} from "./consent";

describe("consent vs suppression", () => {
  it("website inquiry does not grant newsletter", () => {
    expect(
      planConsentGrant({ channel: "inquiry", source: "website_form" }),
    ).toEqual({
      channel: "inquiry",
      status: "granted",
      source: "website_form",
      writeEvent: true,
    });
  });

  it("leaving the newsletter does not suppress or purge", () => {
    expect(planNewsletterWithdraw()).toEqual({
      suppress: false,
      purgePerson: false,
      withdrawChannel: "newsletter",
      status: "withdrawn",
    });
  });

  it("full opt-out unsubscribes and purges", () => {
    expect(planFullOptOut()).toEqual({
      kind: "full_opt_out",
      suppress: true,
      reason: "unsubscribed",
      purgePerson: true,
      withdrawAll: true,
      stayInTouchOptedOut: false,
    });
  });

  it("stay-in-touch unsubscribe stops that mail without purge", () => {
    expect(planCampaignUnsubscribe("newsletter")).toEqual({
      kind: "stay_in_touch_opt_out",
      suppress: false,
      purgePerson: false,
      stayInTouchOptedOut: true,
      cancelMail: true,
    });
    expect(planCampaignUnsubscribe("sales").kind).toBe("full_opt_out");
  });

  it("treats stay-in-touch as a positive grant", () => {
    expect(
      hasStayInTouch([
        { channel: "inquiry", status: "granted" },
        { channel: "stay_in_touch", status: "granted" },
      ]),
    ).toBe(true);
    expect(
      hasStayInTouch([{ channel: "stay_in_touch", status: "withdrawn" }]),
    ).toBe(false);
    expect(hasStayInTouch([{ channel: "inquiry", status: "granted" }])).toBe(
      false,
    );
  });

  it("reads newsletter from a granted row", () => {
    expect(
      hasNewsletterGrant([{ channel: "newsletter", status: "granted" }]),
    ).toBe(true);
    expect(
      hasNewsletterGrant([{ channel: "newsletter", status: "withdrawn" }]),
    ).toBe(false);
  });
});
