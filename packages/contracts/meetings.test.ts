import { describe, expect, it } from "vitest";
import {
  calendarEventAttendeeAccepted,
  meetingHeldForScore,
} from "./meetings";
import { PARTNER_MAILBOX_EMAIL, PERSONAL_MAILBOX_EMAIL } from "./mailboxes";

const asOf = Date.parse("2026-09-12T20:00:00.000Z");
const past = Date.parse("2026-08-27T17:00:00.000Z");
const future = Date.parse("2026-09-20T17:00:00.000Z");
const personEmails = ["paul@example.com"];
const mailboxes = [PERSONAL_MAILBOX_EMAIL, PARTNER_MAILBOX_EMAIL];

describe("meetingHeldForScore", () => {
  it("counts explicit held even without acceptance", () => {
    expect(
      meetingHeldForScore({
        outcome: "held",
        scheduledAt: past,
        asOf,
        attendeeAccepted: false,
      }),
    ).toBe(true);
  });

  it("does not count explicit no-show or reschedule even with acceptance", () => {
    expect(
      meetingHeldForScore({
        outcome: "no_show",
        scheduledAt: past,
        asOf,
        attendeeAccepted: true,
      }),
    ).toBe(false);
    expect(
      meetingHeldForScore({
        outcome: "rescheduled",
        scheduledAt: past,
        asOf,
        attendeeAccepted: true,
      }),
    ).toBe(false);
  });

  it("derives held from a past scheduled event with acceptance", () => {
    expect(
      meetingHeldForScore({
        outcome: "scheduled",
        scheduledAt: past,
        asOf,
        attendeeAccepted: true,
      }),
    ).toBe(true);
    expect(
      meetingHeldForScore({
        outcome: null,
        scheduledAt: past,
        asOf,
        attendeeAccepted: true,
      }),
    ).toBe(true);
  });

  it("does not derive held for future events or missing acceptance", () => {
    expect(
      meetingHeldForScore({
        outcome: "scheduled",
        scheduledAt: future,
        asOf,
        attendeeAccepted: true,
      }),
    ).toBe(false);
    expect(
      meetingHeldForScore({
        outcome: "scheduled",
        scheduledAt: past,
        asOf,
        attendeeAccepted: false,
      }),
    ).toBe(false);
  });
});

describe("calendarEventAttendeeAccepted", () => {
  it("requires the matched person to have accepted", () => {
    expect(
      calendarEventAttendeeAccepted({
        attendees: [
          { email: PERSONAL_MAILBOX_EMAIL, responseStatus: "accepted" },
          { email: "Paul@example.com", responseStatus: "accepted" },
        ],
        personEmails,
        mailboxAddresses: mailboxes,
      }),
    ).toBe(true);
    expect(
      calendarEventAttendeeAccepted({
        attendees: [
          { email: "paul@example.com", responseStatus: "needsAction" },
        ],
        personEmails,
        mailboxAddresses: mailboxes,
      }),
    ).toBe(false);
    expect(
      calendarEventAttendeeAccepted({
        attendees: [
          { email: "paul@example.com", responseStatus: "tentative" },
        ],
        personEmails,
        mailboxAddresses: mailboxes,
      }),
    ).toBe(false);
    expect(
      calendarEventAttendeeAccepted({
        attendees: [
          { email: PERSONAL_MAILBOX_EMAIL, responseStatus: "accepted" },
        ],
        personEmails,
        mailboxAddresses: mailboxes,
      }),
    ).toBe(false);
  });

  it("matches plus-tagged person emails", () => {
    expect(
      calendarEventAttendeeAccepted({
        attendees: [
          { email: "jane+jobs@example.com", responseStatus: "accepted" },
        ],
        personEmails: ["jane@example.com"],
        mailboxAddresses: mailboxes,
      }),
    ).toBe(true);
  });
});
