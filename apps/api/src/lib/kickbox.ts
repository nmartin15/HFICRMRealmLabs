import {
  kickboxBlocksSend,
  parseKickboxResult,
  type KickboxResult,
} from "@realm-labs/contracts";

export async function verifyFormEmailWithKickbox(
  apiKey: string,
  email: string,
): Promise<KickboxResult | null> {
  if (!apiKey) {
    return null;
  }
  const url = new URL("https://api.kickbox.com/v2/verify");
  url.searchParams.set("email", email);
  url.searchParams.set("apikey", apiKey);
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      return null;
    }
    const json: unknown = await res.json();
    if (!json || typeof json !== "object" || !("result" in json)) {
      return null;
    }
    const result = parseKickboxResult(
      typeof json.result === "string" ? json.result : null,
    );
    return result;
  } catch {
    return null;
  }
}

export { kickboxBlocksSend };
