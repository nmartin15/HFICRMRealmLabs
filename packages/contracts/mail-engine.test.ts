import { describe, expect, it } from "vitest";
import { PARTNER_MAILBOX_EMAIL, PERSONAL_MAILBOX_EMAIL } from "./mailboxes";
import {
  isBlankMailTemplate,
  MAIL_ENGINE_MAX_TOUCHES,
  MAIL_TEMPLATE_CATALOG,
  mergeMailTemplate,
  planCampaignReplyTo,
  planEnrollmentTouches,
  planMailEngineAction,
  planMailReplyCancel,
  planMailTickEnqueueCount,
  planStayInTouchNextDue,
  shouldScheduleStayInTouchRenewal,
} from "./mail-engine";
import type { CampaignIntensity, CampaignLane } from "./campaign";
import { MS_PER_DAY } from "./scoring";
import { CAMPAIGN_FROM_EMAIL_DEFAULT } from "./send";

describe("planMailEngineAction", () => {
  it("enrolls only on start, not hold or pending_review", () => {
    expect(planMailEngineAction("start")).toBe("enroll");
    expect(planMailEngineAction("stop")).toBe("cancel");
    expect(planMailEngineAction("hold")).toBe("noop");
    expect(planMailEngineAction("pending_review")).toBe("noop");
    expect(planMailEngineAction(null)).toBe("noop");
  });
});

describe("planEnrollmentTouches", () => {
  const enrolledAt = Date.parse("2026-09-19T17:00:00.000Z");

  it("schedules touch 0 only for cold", () => {
    expect(
      planEnrollmentTouches({
        enrolledAt,
        intensity: "cold",
        lane: "sales",
      }),
    ).toEqual([{ touchIndex: 0, dueAt: enrolledAt }]);
  });

  it("schedules a warm bump after 3 days", () => {
    expect(
      planEnrollmentTouches({
        enrolledAt,
        intensity: "warm",
        lane: "sales",
      }),
    ).toEqual([
      { touchIndex: 0, dueAt: enrolledAt },
      { touchIndex: 1, dueAt: enrolledAt + 3 * MS_PER_DAY },
    ]);
  });

  it("schedules one stay-in-touch touch per enrollment, then a 90-day renew", () => {
    expect(
      planEnrollmentTouches({
        enrolledAt,
        intensity: "hot",
        lane: "newsletter",
      }),
    ).toEqual([{ touchIndex: 0, dueAt: enrolledAt }]);
    expect(planStayInTouchNextDue(enrolledAt)).toBe(
      enrolledAt + 90 * MS_PER_DAY,
    );
    expect(
      shouldScheduleStayInTouchRenewal({
        purpose: "newsletter",
        lane: "newsletter",
        optedOut: false,
        hasOpenTouch: false,
      }),
    ).toBe(true);
    expect(
      shouldScheduleStayInTouchRenewal({
        purpose: "newsletter",
        lane: "newsletter",
        optedOut: true,
        hasOpenTouch: false,
      }),
    ).toBe(false);
  });

  it("schedules a hot bump after 2 days and lukewarm after 5", () => {
    expect(
      planEnrollmentTouches({
        enrolledAt,
        intensity: "hot",
        lane: "sales",
      }),
    ).toEqual([
      { touchIndex: 0, dueAt: enrolledAt },
      { touchIndex: 1, dueAt: enrolledAt + 2 * MS_PER_DAY },
    ]);
    expect(
      planEnrollmentTouches({
        enrolledAt,
        intensity: "lukewarm",
        lane: "sales",
      }),
    ).toEqual([
      { touchIndex: 0, dueAt: enrolledAt },
      { touchIndex: 1, dueAt: enrolledAt + 5 * MS_PER_DAY },
    ]);
  });

  it("never schedules more than two touches", () => {
    const intensities: CampaignIntensity[] = [
      "none",
      "soft",
      "cold",
      "lukewarm",
      "warm",
      "hot",
    ];
    const lanes: CampaignLane[] = ["sales", "newsletter"];
    for (const intensity of intensities) {
      for (const lane of lanes) {
        expect(
          planEnrollmentTouches({ enrolledAt, intensity, lane }).length,
        ).toBeLessThanOrEqual(MAIL_ENGINE_MAX_TOUCHES);
      }
    }
  });
});

describe("planCampaignReplyTo", () => {
  it("uses the owner email", () => {
    expect(planCampaignReplyTo(PERSONAL_MAILBOX_EMAIL)).toBe(
      PERSONAL_MAILBOX_EMAIL,
    );
  });

  it("defaults to Stefano when there is no owner", () => {
    expect(planCampaignReplyTo(null)).toBe(PARTNER_MAILBOX_EMAIL);
    expect(planCampaignReplyTo("")).toBe(PARTNER_MAILBOX_EMAIL);
  });

  it("never uses the campaign From as Reply-To", () => {
    expect(planCampaignReplyTo(CAMPAIGN_FROM_EMAIL_DEFAULT)).toBe(
      PARTNER_MAILBOX_EMAIL,
    );
  });
});

describe("planMailReplyCancel", () => {
  it("cancels remaining touches when the reply is after enroll", () => {
    expect(planMailReplyCancel({ enrolledAt: 100, replyAt: 100 })).toBe(true);
    expect(planMailReplyCancel({ enrolledAt: 100, replyAt: 99 })).toBe(false);
  });
});

describe("mail templates", () => {
  it("treats empty subject or body as skip", () => {
    expect(isBlankMailTemplate("", "Hi")).toBe(true);
    expect(isBlankMailTemplate("Hi", "  ")).toBe(true);
    expect(isBlankMailTemplate("Hi", "Body")).toBe(false);
  });

  it("merges only known fields", () => {
    expect(
      mergeMailTemplate(
        "Hi {{firstName}} ({{name}}) — {{program}} {{stage}} {{extra}}",
        {
          name: "Ada Lovelace",
          firstName: "Ada",
          program: "allocation",
          stage: "applied",
        },
      ),
    ).toBe("Hi Ada (Ada Lovelace) — allocation applied {{extra}}");
  });

  it("includes a catalog entry per sales stage plus stay-in-touch", () => {
    expect(MAIL_TEMPLATE_CATALOG.some((row) => row.lane === "newsletter")).toBe(
      true,
    );
    expect(
      MAIL_TEMPLATE_CATALOG.some(
        (row) => row.program === "allocation" && row.stage === "applied",
      ),
    ).toBe(true);
  });
});

describe("planMailTickEnqueueCount", () => {
  it("does not enqueue more than the drain budget leftover", () => {
    expect(
      planMailTickEnqueueCount({
        dueCount: 20,
        alreadyQueued: 0,
        dailyCap: 25,
        alreadySentToday: 0,
        remainingTicksInWindow: 4,
      }),
    ).toBe(5);
  });

  it("enqueues nothing outside the send window", () => {
    expect(
      planMailTickEnqueueCount({
        dueCount: 10,
        alreadyQueued: 0,
        dailyCap: 25,
        alreadySentToday: 0,
        remainingTicksInWindow: 0,
      }),
    ).toBe(0);
  });
});
