import { describe, expect, it } from "vitest";
import {
  PARTNER_MAILBOX_EMAIL,
  PERSONAL_MAILBOX_EMAIL,
} from "./mailboxes";
import {
  canChangeUserRole,
  canConnectMailbox,
  canDeletePerson,
  canViewActivity,
  canViewCard,
  canViewEmailThread,
  canViewMeeting,
  canViewOperatorTask,
  canViewPerson,
  isListedPerson,
} from "./visibility";

const owner = PERSONAL_MAILBOX_EMAIL;
const partner = PARTNER_MAILBOX_EMAIL;
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
  it("shows matched contact threads to every operator", () => {
    expect(
      canViewEmailThread({
        mailbox: "partner",
        sharedVisible: false,
        viewerEmail: owner,
        linkedToPerson: true,
      }),
    ).toBe(true);
    expect(
      canViewEmailThread({
        mailbox: "personal",
        sharedVisible: false,
        viewerEmail: partner,
        linkedToPerson: true,
      }),
    ).toBe(true);
  });

  it("hides unmatched partner threads from the other operator", () => {
    expect(
      canViewEmailThread({
        mailbox: "partner",
        sharedVisible: false,
        viewerEmail: owner,
      }),
    ).toBe(false);
    expect(
      canViewEmailThread({
        mailbox: "personal",
        sharedVisible: false,
        viewerEmail: partner,
      }),
    ).toBe(false);
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

  it("shows partner threads to Stefano", () => {
    expect(
      canViewEmailThread({
        mailbox: "partner",
        sharedVisible: false,
        viewerEmail: partner,
      }),
    ).toBe(true);
  });

  it("shows operator threads to everyone when shared_visible is true", () => {
    expect(
      canViewEmailThread({
        mailbox: "personal",
        sharedVisible: true,
        viewerEmail: teammate,
      }),
    ).toBe(true);
    expect(
      canViewEmailThread({
        mailbox: "partner",
        sharedVisible: true,
        viewerEmail: owner,
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

  it("uses the connected mailbox email when supplied", () => {
    expect(
      canViewEmailThread({
        mailbox: "partner",
        sharedVisible: false,
        viewerEmail: partner,
        mailboxEmail: "stefano@realmlabs.co",
      }),
    ).toBe(true);
    expect(
      canViewEmailThread({
        mailbox: "partner",
        sharedVisible: false,
        viewerEmail: owner,
        mailboxEmail: "stefano@realmlabs.co",
      }),
    ).toBe(false);
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

  it("allows admin to connect any operator mailbox", () => {
    expect(
      canConnectMailbox({
        role: "admin",
        actorEmail: owner,
        mailboxEmail: partner,
      }),
    ).toBe(true);
  });

  it("allows a member to connect only their own mailbox", () => {
    expect(
      canConnectMailbox({
        role: "member",
        actorEmail: partner,
        mailboxEmail: partner,
      }),
    ).toBe(true);
    expect(
      canConnectMailbox({
        role: "member",
        actorEmail: partner,
        mailboxEmail: owner,
      }),
    ).toBe(false);
  });
});

describe("operator task visibility", () => {
  it("shows an operator only their own tasks", () => {
    expect(
      canViewOperatorTask({
        role: "member",
        viewerId: "stefano",
        createdBy: "nathan",
        includeAllOperators: false,
      }),
    ).toBe(false);
    expect(
      canViewOperatorTask({
        role: "member",
        viewerId: "stefano",
        createdBy: "stefano",
        includeAllOperators: true,
      }),
    ).toBe(true);
  });

  it("lets admin include the other operator's tasks", () => {
    expect(
      canViewOperatorTask({
        role: "admin",
        viewerId: "nathan",
        createdBy: "stefano",
        includeAllOperators: false,
      }),
    ).toBe(false);
    expect(
      canViewOperatorTask({
        role: "admin",
        viewerId: "nathan",
        createdBy: "stefano",
        includeAllOperators: true,
      }),
    ).toBe(true);
  });
});

describe("do not contact list exclusion", () => {
  it("omits DNC people from lists and exports", () => {
    expect(isListedPerson(true)).toBe(false);
    expect(isListedPerson(false)).toBe(true);
  });
});
