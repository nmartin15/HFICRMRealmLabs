import { secretsEqual } from "./secrets.js";

export function parseBasicAuth(
  header: string | undefined,
): { user: string; password: string } | null {
  if (!header) {
    return null;
  }
  const match = /^Basic\s+(\S+)$/i.exec(header.trim());
  if (!match?.[1]) {
    return null;
  }
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep <= 0) {
    return null;
  }
  return {
    user: decoded.slice(0, sep),
    password: decoded.slice(sep + 1),
  };
}

export function basicAuthMatches(
  header: string | undefined,
  user: string,
  password: string,
): boolean {
  const parsed = parseBasicAuth(header);
  if (!parsed || user.length === 0 || password.length === 0) {
    return false;
  }
  return secretsEqual(parsed.user, user) && secretsEqual(parsed.password, password);
}
