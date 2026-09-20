import { canonicalEmail } from "@realm-labs/contracts";
import { hmacSha256Hex } from "@realm-labs/db";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  calls: 0,
}));

vi.mock("./postmark.js", () => ({
  sendWithPostmark: async () => {
    provider.calls += 1;
    return { ok: true, messageId: "pm-1" };
  },
}));

const { deliverOutboundSend, outboundEmailHash } = await import("./deliver.js");

const KEY = "ab".repeat(32);
const SEND_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "22222222-2222-4222-8222-222222222222";
const here = dirname(fileURLToPath(import.meta.url));
const deliverSource = readFileSync(join(here, "deliver.ts"), "utf8");
const outboundSource = readFileSync(
  join(here, "../../../../packages/db/outbound-sends.ts"),
  "utf8",
);

const env = {
  EMAIL_HASH_KEY: KEY,
  POSTMARK_SEND_ENABLED: true,
  POSTMARK_SERVER_TOKEN: "token",
  POSTMARK_MESSAGE_STREAM: "broadcast",
  CAMPAIGN_FROM_EMAIL: "hello@mail.realmlabs.co",
  CAMPAIGN_FROM_NAME: "Realm Labs",
  WEB_ORIGIN: "http://localhost:3000",
};

function queuedSend(status: "queued" | "sending" | "blocked" | "sent") {
  return {
    id: SEND_ID,
    personId: null,
    emailHash: outboundEmailHash(KEY, "ada@example.com"),
    toEmail: "ada@example.com",
    purpose: "sales",
    subject: "Hi",
    bodyText: "Hello",
    tag: "rl.v1.test",
    isSeed: true,
    status,
    unsubscribeToken: TOKEN,
    providerMessageId: null,
    sentAt: null,
    replyTo: "stefano@realmlabs.co",
  };
}

function deliverDb(input: { claim: boolean }) {
  let status: "queued" | "sending" | "blocked" | "sent" = "queued";
  const ops: string[] = [];
  return {
    ops,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (status === "queued" || status === "sending") {
              return [queuedSend(status)];
            }
            return [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: { status?: string }) => ({
        where: () => {
          ops.push(`update:${values.status ?? "unknown"}`);
          if (values.status === "sending") {
            if (!input.claim || status !== "queued") {
              return { returning: async () => [] };
            }
            status = "sending";
            return { returning: async () => [{ id: SEND_ID }] };
          }
          if (values.status === "sent") {
            if (status !== "sending") {
              return { returning: async () => [] };
            }
            status = "sent";
            return { returning: async () => [{ id: SEND_ID }] };
          }
          return { returning: async () => [] };
        },
      }),
    }),
    insert: () => ({
      values: async () => [{ id: "act-1" }],
    }),
  };
}

describe("outbound drain wiring", () => {
  beforeEach(() => {
    provider.calls = 0;
  });

  it("hashes plus-tagged seed addresses onto the canonical tombstone", () => {
    expect(outboundEmailHash(KEY, "Nathan+Seed@Gmail.COM")).toBe(
      hmacSha256Hex(KEY, canonicalEmail("nathan@gmail.com")),
    );
    expect(outboundEmailHash(KEY, "nathan+seed@gmail.com")).toBe(
      outboundEmailHash(KEY, "nathan@gmail.com"),
    );
  });

  it("claims sending while queued, then calls Postmark, then marks sent", () => {
    const fn = deliverSource.slice(
      deliverSource.indexOf("export async function deliverOutboundSend"),
    );
    const claimAt = fn.indexOf("claimOutboundSendingIfQueued");
    const postmarkAt = fn.indexOf("sendWithPostmark");
    const sentAt = fn.indexOf("markOutboundSentIfSending");
    expect(claimAt).toBeGreaterThan(-1);
    expect(postmarkAt).toBeGreaterThan(claimAt);
    expect(sentAt).toBeGreaterThan(postmarkAt);
    expect(deliverSource).toContain("loadSendById");
    expect(deliverSource).toContain("planOutboundDrainRelease");
    expect(deliverSource).not.toContain("prepareOutboundDelivery");
    expect(deliverSource).not.toContain("markOutboundSentIfQueued");
    expect(deliverSource).toContain("withOutboundDrainLock");
    expect(deliverSource).toContain("stuckSending");
    expect(deliverSource).toContain('eq(outboundSends.status, "sending")');
    expect(outboundSource).toContain("pg_advisory_lock");
    expect(outboundSource).toContain('"sending"');
    expect(outboundSource).toContain("inArray");
  });

  it("does not call Postmark when the queued claim loses", async () => {
    const db = deliverDb({ claim: false });
    const sent = await deliverOutboundSend(db as never, env as never, SEND_ID);
    expect(sent).toBe(false);
    expect(provider.calls).toBe(0);
  });

  it("calls Postmark only after a successful sending claim", async () => {
    const db = deliverDb({ claim: true });
    const sent = await deliverOutboundSend(db as never, env as never, SEND_ID);
    expect(sent).toBe(true);
    expect(provider.calls).toBe(1);
    expect(db.ops[0]).toBe("update:sending");
    expect(db.ops.includes("update:sent")).toBe(true);
  });
});
