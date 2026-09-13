import {
  CAMPAIGN_FROM_NAME_DEFAULT,
  POSTMARK_BROADCAST_STREAM,
} from "@realm-labs/contracts";

export type PostmarkSendInput = {
  serverToken: string;
  messageStream: string;
  fromEmail: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  tag: string | null;
  unsubscribeUrl: string;
  metadata: Record<string, string>;
};

export type PostmarkSendResult =
  | { ok: true; messageId: string }
  | { ok: false; message: string };

export async function sendWithPostmark(
  input: PostmarkSendInput,
): Promise<PostmarkSendResult> {
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": input.serverToken,
    },
    body: JSON.stringify({
      From: `${input.fromName || CAMPAIGN_FROM_NAME_DEFAULT} <${input.fromEmail}>`,
      To: input.to,
      Subject: input.subject,
      TextBody: input.text,
      MessageStream: input.messageStream || POSTMARK_BROADCAST_STREAM,
      Tag: input.tag ?? undefined,
      Headers: [
        { Name: "List-Unsubscribe", Value: `<${input.unsubscribeUrl}>` },
        {
          Name: "List-Unsubscribe-Post",
          Value: "List-Unsubscribe=One-Click",
        },
      ],
      Metadata: input.metadata,
    }),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      json && typeof json === "object" && "Message" in json
        ? String(json.Message)
        : `Postmark HTTP ${res.status}`;
    return { ok: false, message };
  }
  if (
    !json ||
    typeof json !== "object" ||
    !("MessageID" in json) ||
    typeof json.MessageID !== "string"
  ) {
    return { ok: false, message: "Postmark response missing MessageID" };
  }
  return { ok: true, messageId: json.MessageID };
}
