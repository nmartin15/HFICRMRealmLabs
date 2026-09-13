import { afterEach, describe, expect, it, vi } from "vitest";
import { alertSinkRequiredForSend, fireAlert } from "./alert.js";

describe("fireAlert", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs Slack-shaped JSON to the webhook", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fireAlert(
      { ALERT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/X" },
      "outbound.complaint_gmail_limit complaintRate=0.003",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const invoked = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; body: string },
    ];
    expect(invoked[0]).toBe("https://hooks.slack.com/services/T/B/X");
    expect(invoked[1].method).toBe("POST");
    const payload = JSON.parse(invoked[1].body) as {
      text: string;
      content: string;
    };
    expect(payload.text).toContain("ALERT outbound.complaint_gmail_limit");
    expect(payload.content).toBe(payload.text);
  });

  it("does not fetch when the sink is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await fireAlert({ ALERT_WEBHOOK_URL: "" }, "noop");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses send without a sink so the flag cannot flip silently", () => {
    expect(
      alertSinkRequiredForSend({
        sendEnabled: true,
        alertWebhookUrl: "",
      }),
    ).toBe(true);
    expect(
      alertSinkRequiredForSend({
        sendEnabled: true,
        alertWebhookUrl: "https://hooks.slack.com/services/T/B/X",
      }),
    ).toBe(false);
    expect(
      alertSinkRequiredForSend({
        sendEnabled: false,
        alertWebhookUrl: "",
      }),
    ).toBe(false);
  });
});
