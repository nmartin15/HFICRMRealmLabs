import { describe, expect, it } from "vitest";
import {
  canonicalEmail,
  decodeGmailBase64Url,
  emailMessageDirection,
  emailSnippet,
  emailsMatch,
  extractGmailPlainText,
  htmlToPlainText,
  isInboundFromPerson,
  isInboundReply,
  matchPersonFromParticipants,
  parseEmailAddresses,
} from "./email-matching";
import { PERSONAL_MAILBOX_EMAIL, SHARED_MAILBOX_EMAIL } from "./mailboxes";

const jane = { id: "11111111-1111-4111-8111-111111111111", email: "jane@example.com" };
const alex = { id: "22222222-2222-4222-8222-222222222222", email: "alex@example.com" };
const mailboxes = [PERSONAL_MAILBOX_EMAIL, SHARED_MAILBOX_EMAIL];

describe("email matching", () => {
  it("matches case-insensitively", () => {
    expect(emailsMatch("Jane@Example.COM", "jane@example.com")).toBe(true);
    expect(canonicalEmail("  Jane@Example.COM ")).toBe("jane@example.com");
    expect(
      matchPersonFromParticipants(
        ["Jane@Example.COM"],
        [jane],
        mailboxes,
      )?.id,
    ).toBe(jane.id);
  });

  it("matches plus addressing in either direction", () => {
    expect(emailsMatch("jane+jobs@example.com", "jane@example.com")).toBe(true);
    expect(emailsMatch("jane@example.com", "jane+recruiting@example.com")).toBe(
      true,
    );
    expect(canonicalEmail("jane+jobs@example.com")).toBe("jane@example.com");
    expect(
      matchPersonFromParticipants(
        ["Jane+Jobs@example.com"],
        [{ ...jane, email: "jane@example.com" }],
        mailboxes,
      )?.id,
    ).toBe(jane.id);
    expect(
      matchPersonFromParticipants(
        ["jane@example.com"],
        [{ ...jane, email: "jane+workable@example.com" }],
        mailboxes,
      )?.id,
    ).toBe(jane.id);
  });

  it("matches the first person among multiple participants and skips mailbox addresses", () => {
    const participants = [
      SHARED_MAILBOX_EMAIL,
      "unknown@other.com",
      "ALEX@example.com",
      "jane@example.com",
    ];
    expect(
      matchPersonFromParticipants(participants, [jane, alex], mailboxes)?.id,
    ).toBe(alex.id);
  });

  it("returns null when no person matches", () => {
    expect(
      matchPersonFromParticipants(
        [SHARED_MAILBOX_EMAIL, "stranger@example.com"],
        [jane],
        mailboxes,
      ),
    ).toBeNull();
  });

  it("parses addresses from RFC-style headers", () => {
    expect(
      parseEmailAddresses(
        `"Jane Doe" <Jane+Jobs@example.com>, Nathan <${PERSONAL_MAILBOX_EMAIL}>`,
      ),
    ).toEqual(["jane+jobs@example.com", PERSONAL_MAILBOX_EMAIL]);
  });

  it("treats outbound mailbox From as not inbound", () => {
    expect(
      isInboundFromPerson(PERSONAL_MAILBOX_EMAIL, jane.email, mailboxes),
    ).toBe(false);
    expect(isInboundFromPerson("JANE@example.com", jane.email, mailboxes)).toBe(
      true,
    );
  });

  it("requires a prior message or In-Reply-To for an inbound reply", () => {
    expect(
      isInboundReply({
        latestFrom: jane.email,
        personEmail: jane.email,
        messageCount: 1,
        inReplyTo: null,
        mailboxAddresses: mailboxes,
      }),
    ).toBe(false);
    expect(
      isInboundReply({
        latestFrom: jane.email,
        personEmail: jane.email,
        messageCount: 2,
        inReplyTo: null,
        mailboxAddresses: mailboxes,
      }),
    ).toBe(true);
    expect(
      isInboundReply({
        latestFrom: jane.email,
        personEmail: jane.email,
        messageCount: 1,
        inReplyTo: "<abc@mail.gmail.com>",
        mailboxAddresses: mailboxes,
      }),
    ).toBe(true);
  });

  it("stores snippets only, truncated to 300 characters", () => {
    const snippet = emailSnippet(`  ${"a".repeat(400)}  `);
    expect(snippet.length).toBe(300);
  });

  it("labels outbound mailbox From and inbound person From", () => {
    expect(
      emailMessageDirection({
        fromEmail: PERSONAL_MAILBOX_EMAIL,
        personEmail: jane.email,
        mailboxAddresses: mailboxes,
      }),
    ).toBe("outbound");
    expect(
      emailMessageDirection({
        fromEmail: "JANE+jobs@example.com",
        personEmail: jane.email,
        mailboxAddresses: mailboxes,
      }),
    ).toBe("inbound");
    expect(
      emailMessageDirection({
        fromEmail: "other@example.com",
        personEmail: jane.email,
        mailboxAddresses: mailboxes,
      }),
    ).toBe("other");
  });

  it("extracts text/plain from nested Gmail MIME and ignores HTML", () => {
    const plain = btoa("Hello from Jane");
    const html = btoa("<p>HTML body</p>");
    const body = extractGmailPlainText({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: plain } },
            { mimeType: "text/html", body: { data: html } },
          ],
        },
        {
          mimeType: "application/pdf",
          filename: "resume.pdf",
          body: { data: btoa("not-text") },
        },
      ],
    });
    expect(body).toBe("Hello from Jane");
  });

  it("falls back to stripped HTML when there is no text/plain", () => {
    const html = btoa(
      "<p>Hi &amp; welcome</p><br>Line 2<script>alert(1)</script>",
    );
    expect(
      extractGmailPlainText({
        mimeType: "text/html",
        body: { data: html },
      }),
    ).toBe("Hi & welcome\n\nLine 2");
  });

  it("decodes Gmail base64url and does not truncate bodies", () => {
    const long = `Hello ${"a".repeat(400)}`;
    const encoded = btoa(long).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    expect(decodeGmailBase64Url(encoded)).toBe(long);
    expect(
      extractGmailPlainText({
        mimeType: "text/plain",
        body: { data: encoded },
      }),
    ).toBe(long);
  });

  it("converts HTML entities and tags to plain text", () => {
    expect(htmlToPlainText("<div>A&nbsp;B &#39;quote&#x27;</div>")).toBe(
      "A B 'quote'",
    );
  });
});
