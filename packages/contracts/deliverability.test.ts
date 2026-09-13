import { describe, expect, it } from "vitest";
import {
  complaintRateOverGmailLimit,
  complaintRateWatch,
  deliverabilityRates,
  planOutboundDrainRelease,
} from "./deliverability";
import { COMPLAINT_RATE_GMAIL_LIMIT, COMPLAINT_RATE_WATCH } from "./send";

describe("deliverability rates", () => {
  it("uses sent as the denominator and watches at 0.1 percent", () => {
    expect(
      deliverabilityRates({ sent: 1000, bounced: 20, complained: 1 }),
    ).toEqual({ bounceRate: 0.02, complaintRate: 0.001 });
    expect(complaintRateWatch(COMPLAINT_RATE_WATCH)).toBe(true);
    expect(complaintRateWatch(COMPLAINT_RATE_WATCH - 0.0001)).toBe(false);
    expect(deliverabilityRates({ sent: 0, bounced: 1, complained: 1 })).toEqual({
      bounceRate: 0,
      complaintRate: 0,
    });
  });

  it("halts drain at the Gmail complaint limit", () => {
    expect(planOutboundDrainRelease(COMPLAINT_RATE_GMAIL_LIMIT)).toEqual({
      halt: true,
      reason: "complaint_gmail_limit",
    });
    expect(
      planOutboundDrainRelease(COMPLAINT_RATE_GMAIL_LIMIT - 0.0001),
    ).toEqual({ halt: false });
    expect(complaintRateOverGmailLimit(COMPLAINT_RATE_GMAIL_LIMIT)).toBe(true);
  });
});
