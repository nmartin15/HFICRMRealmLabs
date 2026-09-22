import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_FROM_EMAIL_DEFAULT,
  dailySendCap,
  isCampaignFromAddress,
  parseSeedEmails,
  planOutboundDeliver,
  planOutboundSend,
  remainingSendTicksInWindow,
  SEND_BLOCKED_CODE,
  SEND_WARMUP_MAX_CAP,
  sendTickBudget,
} from "./send";
import { DISPLAY_TIME_ZONE, zonedLocalToUtc } from "./time";

describe("outbound send gate", () => {
  it("blocks all sends for fully suppressed addresses as the first check", () => {
    const blocked = planOutboundSend({
      suppressionReason: "unsubscribed",
      purpose: "newsletter",
      stayInTouch: false,
      doNotContact: false,
      stayInTouchOptedOut: false,
    });
    expect(blocked).toEqual({
      ok: false,
      code: SEND_BLOCKED_CODE,
      message: "Address is suppressed",
    });
  });

  it("blocks campaign mail to recruiter contacts", () => {
    expect(
      planOutboundSend({
        suppressionReason: null,
        purpose: "sales",
        stayInTouch: false,
        doNotContact: false,
        stayInTouchOptedOut: false,
        contactKind: "recruiter",
      }),
    ).toEqual({
      ok: false,
      code: SEND_BLOCKED_CODE,
      message: "Recruiters are not campaign recipients",
    });
  });

  it("blocks sales to rejected-but-interested and allows stay-in-touch unless opted out", () => {
    expect(
      planOutboundSend({
        suppressionReason: "rejected",
        purpose: "sales",
        stayInTouch: false,
        doNotContact: false,
        stayInTouchOptedOut: false,
      }).ok,
    ).toBe(false);
    expect(
      planOutboundSend({
        suppressionReason: "rejected",
        purpose: "newsletter",
        stayInTouch: false,
        doNotContact: false,
        stayInTouchOptedOut: false,
      }).ok,
    ).toBe(true);
    expect(
      planOutboundSend({
        suppressionReason: "rejected",
        purpose: "value_add",
        stayInTouch: false,
        doNotContact: false,
        stayInTouchOptedOut: false,
      }).ok,
    ).toBe(true);
    expect(
      planOutboundSend({
        suppressionReason: "rejected",
        purpose: "newsletter",
        stayInTouch: false,
        doNotContact: false,
        stayInTouchOptedOut: true,
      }).ok,
    ).toBe(false);
  });

  it("blocks form-intake addresses Kickbox marked undeliverable", () => {
    expect(
      planOutboundSend({
        suppressionReason: null,
        purpose: "sales",
        stayInTouch: false,
        doNotContact: false,
        stayInTouchOptedOut: false,
        emailUndeliverable: true,
      }),
    ).toMatchObject({ ok: false, code: "UNDELIVERABLE" });
  });

  it("re-checks suppression at dequeue so a queued row cannot send after unsubscribe", () => {
    const enqueue = planOutboundSend({
      suppressionReason: null,
      purpose: "sales",
      stayInTouch: false,
      doNotContact: false,
      stayInTouchOptedOut: false,
    });
    expect(enqueue.ok).toBe(true);

    const dequeue = planOutboundDeliver({
      suppressionReason: "unsubscribed",
      purpose: "sales",
      stayInTouch: false,
      doNotContact: false,
      stayInTouchOptedOut: false,
    });
    expect(dequeue).toEqual({
      ok: false,
      code: SEND_BLOCKED_CODE,
      message: "Address is suppressed",
    });
  });

  it("spreads low volume across the remaining window instead of dumping it", () => {
    expect(
      sendTickBudget({
        dailyCap: 50,
        alreadySentToday: 0,
        queued: 3,
        remainingTicksInWindow: 8,
      }),
    ).toBe(1);
    expect(
      sendTickBudget({
        dailyCap: 25,
        alreadySentToday: 25,
        queued: 10,
        remainingTicksInWindow: 4,
      }),
    ).toBe(0);
  });

  it("canonicalizes seed addresses so plus aliases share the tombstone", () => {
    expect(parseSeedEmails("Nathan+Seed@Gmail.COM, nathan@gmail.com")).toEqual([
      "nathan@gmail.com",
    ]);
  });

  it("lets seed inboxes receive campaign copies without consent, but not after unsubscribe", () => {
    expect(
      planOutboundDeliver({
        suppressionReason: null,
        purpose: "newsletter",
        stayInTouch: false,
        doNotContact: false,
        stayInTouchOptedOut: false,
        isSeed: true,
      }).ok,
    ).toBe(true);
    expect(
      planOutboundDeliver({
        suppressionReason: "unsubscribed",
        purpose: "newsletter",
        stayInTouch: false,
        doNotContact: false,
        stayInTouchOptedOut: false,
        isSeed: true,
      }),
    ).toMatchObject({ ok: false, code: SEND_BLOCKED_CODE });
  });

  it("holds sends outside the 9–18 Los Angeles window and ramps the daily cap", () => {
    const ymd = { year: 2026, month: 9, day: 14 };
    expect(
      remainingSendTicksInWindow(
        zonedLocalToUtc(ymd, DISPLAY_TIME_ZONE, 8, 59, 0),
      ),
    ).toBe(0);
    expect(
      remainingSendTicksInWindow(
        zonedLocalToUtc(ymd, DISPLAY_TIME_ZONE, 18, 0, 0),
      ),
    ).toBe(0);
    expect(
      remainingSendTicksInWindow(
        zonedLocalToUtc(ymd, DISPLAY_TIME_ZONE, 9, 0, 0),
      ),
    ).toBeGreaterThan(0);
    expect(dailySendCap(0)).toBe(25);
    expect(dailySendCap(19)).toBe(SEND_WARMUP_MAX_CAP);
    expect(dailySendCap(40)).toBe(SEND_WARMUP_MAX_CAP);
  });

  it("keeps campaign From off every operator mailbox on realmlabs.co", () => {
    expect(isCampaignFromAddress(CAMPAIGN_FROM_EMAIL_DEFAULT)).toBe(true);
    expect(isCampaignFromAddress("nathan@realmlabs.co")).toBe(false);
    expect(isCampaignFromAddress("stefano@realmlabs.co")).toBe(false);
    expect(isCampaignFromAddress("anyone@realmlabs.co")).toBe(false);
  });
});
