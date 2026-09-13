export type AlertWebhookEnv = {
  ALERT_WEBHOOK_URL: string;
};

export async function fireAlert(
  env: AlertWebhookEnv,
  message: string,
): Promise<void> {
  const text = message.startsWith("ALERT ") ? message : `ALERT ${message}`;
  console.error(text);
  const url = env.ALERT_WEBHOOK_URL.trim();
  if (!url) {
    return;
  }
  const body = JSON.stringify({ text, content: text });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!res.ok) {
      console.error(`ALERT webhook HTTP ${res.status}`);
    }
  } catch (error) {
    console.error("ALERT webhook failed", error);
  }
}

export function alertSinkRequiredForSend(input: {
  sendEnabled: boolean;
  alertWebhookUrl: string;
}): boolean {
  return input.sendEnabled && input.alertWebhookUrl.trim().length === 0;
}
