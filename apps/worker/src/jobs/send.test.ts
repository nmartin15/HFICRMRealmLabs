import { beforeEach, describe, expect, it, vi } from "vitest";

const drainOutboundSends = vi.fn();
const fireAlert = vi.fn();

vi.mock("../lib/deliver.js", () => ({
  drainOutboundSends: (...args: unknown[]) => drainOutboundSends(...args),
}));

vi.mock("../lib/alert.js", () => ({
  fireAlert: (...args: unknown[]) => fireAlert(...args),
}));

const { runOutboundDrain } = await import("./send.js");

describe("runOutboundDrain", () => {
  beforeEach(() => {
    drainOutboundSends.mockReset();
    fireAlert.mockReset();
  });

  it("fires the alert webhook when drain halts", async () => {
    drainOutboundSends.mockResolvedValue({
      attempted: 3,
      sent: 0,
      halted: "complaint_gmail_limit",
    });
    const env = { ALERT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/X" };
    await runOutboundDrain({} as never, env as never);
    expect(fireAlert).toHaveBeenCalledTimes(1);
    expect(fireAlert.mock.calls[0]?.[1]).toMatch(/complaint_gmail_limit/);
  });

  it("alerts when drain reports stuck sending claims", async () => {
    drainOutboundSends.mockResolvedValue({
      attempted: 0,
      sent: 0,
      halted: null,
      stuckSending: 2,
    });
    const env = { ALERT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/X" };
    await runOutboundDrain({} as never, env as never);
    expect(fireAlert).toHaveBeenCalledTimes(1);
    expect(fireAlert.mock.calls[0]?.[1]).toMatch(/stuck_sending=2/);
  });

  it("does not fire when drain sends normally", async () => {
    drainOutboundSends.mockResolvedValue({
      attempted: 1,
      sent: 1,
      halted: null,
      stuckSending: 0,
    });
    await runOutboundDrain({} as never, {
      ALERT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/X",
      POSTMARK_SEND_ENABLED: true,
    } as never);
    expect(fireAlert).not.toHaveBeenCalled();
  });
});
