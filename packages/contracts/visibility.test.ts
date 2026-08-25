import { describe, expect, it } from "vitest";
import { PERSONAL_MAILBOX_EMAIL } from "./mailboxes";
import {
  canChangeUserRole,
  canConnectMailbox,
  canDeletePerson,
  canViewActivity,
  canViewCard,
  canViewEmailThread,
  canViewMeeting,
  canViewPerson,
  isListedPerson,
} from "./visibility";

const owner = PERSONAL_MAILBOX_EMAIL;
const teammate = "teammate@realmlabs.co";

describe("team-wide visibility", () => {
  it("lets every user see people, cards, meetings, and activities", () => {
    expect(canViewPerson()).toBe(true);
    expect(canViewCard()).toBe(true);
    expect(canViewMeeting()).toBe(true);
    expect(canViewActivity()).toBe(true);
  });
});

describe("email thread visibility", () => {
  it("shows shared mailbox threads to everyone", () => {
    expect(
      canViewEmailThread({
        mailbox: "shared",
        sharedVisible: false,
        viewerEmail: teammate,
      }),
    ).toBe(true);
  });

  it("hides personal threads from non-owners", () => {
    expect(
      canViewEmailThread({
        mailbox: "personal",
        sharedVisible: false,
        viewerEmail: teammate,
      }),
    ).toBe(false);
  });

  it("shows personal threads to the mailbox owner", () => {
    expect(
      canViewEmailThread({
        mailbox: "personal",
        sharedVisible: false,
        viewerEmail: owner,
      }),
    ).toBe(true);
  });

  it("shows personal threads to everyone when shared_visible is true", () => {
    expect(
      canViewEmailThread({
        mailbox: "personal",
        sharedVisible: true,
        viewerEmail: teammate,
      }),
    ).toBe(true);
  });

  it("matches owner email case-insensitively", () => {
    expect(
      canViewEmailThread({
        mailbox: "personal",
        sharedVisible: false,
        viewerEmail: "Nathan@RealmLabs.CO",
      }),
    ).toBe(true);
  });
});

describe("admin-only mutations", () => {
  it("allows only admin to delete people", () => {
    expect(canDeletePerson("admin")).toBe(true);
    expect(canDeletePerson("member")).toBe(false);
  });

  it("allows only admin to change user roles", () => {
    expect(canChangeUserRole("admin")).toBe(true);
    expect(canChangeUserRole("member")).toBe(false);
  });

  it("allows only admin to connect mailboxes", () => {
    expect(canConnectMailbox("admin")).toBe(true);
    expect(canConnectMailbox("member")).toBe(false);
  });
});

describe("do not contact list exclusion", () => {
  it("omits DNC people from lists and exports", () => {
    expect(isListedPerson(true)).toBe(false);
    expect(isListedPerson(false)).toBe(true);
  });
});
