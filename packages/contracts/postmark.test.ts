import { describe, expect, it } from "vitest";
import {
  duplicatePostmarkNeedsTombstone,
  planPostmarkWebhook,
  planSoftBounceSuppress,
  unsubscribeHttpAction,
} from "./postmark";
import { SEND_SOFT_BOUNCE_SUPPRESS_AFTER } from "./send";

describe("postmark webhook planner", () => {
  it("suppresses hard bounces and complaints with no human in the loop", () => {
    expect(
      planPostmarkWebhook({
        RecordType: "Bounce",
        Type: "HardBounce",
        Email: "Ada@Example.COM",
        MessageID: "m1",
      }),
    ).toEqual({
      kind: "hard_bounce",
      email: "ada@example.com",
      messageId: "m1",
      reason: "hard_bounced",
    });
    expect(
      planPostmarkWebhook({
        RecordType: "SpamComplaint",
        Email: "ada@example.com",
        MessageID: "m2",
      }),
    ).toEqual({
      kind: "complaint",
      email: "ada@example.com",
      messageId: "m2",
      reason: "complained",
    });
  });

  it("counts soft bounces until the suppress threshold", () => {
    expect(
      planPostmarkWebhook({
        RecordType: "Bounce",
        Type: "SoftBounce",
        Email: "ada@example.com",
      }).kind,
    ).toBe("soft_bounce");
    expect(planSoftBounceSuppress(SEND_SOFT_BOUNCE_SUPPRESS_AFTER - 1)).toBe(
      false,
    );
    expect(planSoftBounceSuppress(SEND_SOFT_BOUNCE_SUPPRESS_AFTER)).toBe(true);
  });

  it("treats GET as confirm and POST as the write", () => {
    expect(unsubscribeHttpAction("GET")).toBe("confirm");
    expect(unsubscribeHttpAction("get")).toBe("confirm");
    expect(unsubscribeHttpAction("POST")).toBe("write");
    expect(unsubscribeHttpAction("post")).toBe("write");
  });

  it("re-checks bounce and complaint tombstones on a duplicate event", () => {
    expect(
      duplicatePostmarkNeedsTombstone({
        kind: "complaint",
        currentReason: null,
      }),
    ).toBe(true);
    expect(
      duplicatePostmarkNeedsTombstone({
        kind: "hard_bounce",
        currentReason: null,
      }),
    ).toBe(true);
    expect(
      duplicatePostmarkNeedsTombstone({
        kind: "complaint",
        currentReason: "unsubscribed",
      }),
    ).toBe(false);
    expect(
      duplicatePostmarkNeedsTombstone({
        kind: "complaint",
        currentReason: "rejected",
      }),
    ).toBe(true);
    expect(
      duplicatePostmarkNeedsTombstone({
        kind: "delivery",
        currentReason: null,
      }),
    ).toBe(false);
  });

  it("treats one-click and subscription-change unsubscribes as immediate unsub", () => {
    expect(
      planPostmarkWebhook({
        RecordType: "SubscriptionChange",
        Recipient: "ada@example.com",
        SuppressSending: true,
        SuppressionReason: "ManualSuppression",
        Metadata: { purpose: "newsletter" },
      }).kind,
    ).toBe("stay_in_touch_opt_out");
    expect(
      planPostmarkWebhook({
        RecordType: "SubscriptionChange",
        Recipient: "ada@example.com",
        SuppressSending: true,
        SuppressionReason: "ManualSuppression",
      }),
    ).toMatchObject({ kind: "unsubscribe", reason: "unsubscribed" });
    expect(
      planPostmarkWebhook({
        RecordType: "Bounce",
        Type: "Unsubscribe",
        Email: "ada@example.com",
      }).kind,
    ).toBe("unsubscribe");
  });
});
