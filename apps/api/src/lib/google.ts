import {
  CALENDAR_READONLY_SCOPE,
  GMAIL_READONLY_SCOPE,
  PERSONAL_MAILBOX_EMAIL,
  SHARED_MAILBOX_EMAIL,
  type Mailbox,
} from "@realm-labs/contracts";
import { google } from "googleapis";
import type { Env } from "../env.js";

function createOAuthClient(env: Env, redirectUri: string) {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    redirectUri,
  );
}

export function googleLoginUrl(env: Env, state: string): string {
  const oauth2 = createOAuthClient(env, env.GOOGLE_REDIRECT_URI);
  return oauth2.generateAuthUrl({
    access_type: "online",
    prompt: "select_account",
    hd: env.ALLOWED_HOSTED_DOMAIN,
    scope: ["openid", "email", "profile"],
    state,
  });
}

export function googleMailboxUrl(
  env: Env,
  state: string,
  mailbox: Mailbox,
): string {
  const oauth2 = createOAuthClient(env, env.GOOGLE_MAILBOX_REDIRECT_URI);
  const scopes = ["openid", "email", GMAIL_READONLY_SCOPE];
  if (mailbox === "personal") {
    scopes.push(CALENDAR_READONLY_SCOPE);
  }
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    hd: env.ALLOWED_HOSTED_DOMAIN,
    scope: scopes,
    state,
    login_hint:
      mailbox === "personal" ? PERSONAL_MAILBOX_EMAIL : SHARED_MAILBOX_EMAIL,
  });
}

export type GoogleProfile = {
  id: string;
  email: string;
  name: string;
  hd: string | null;
};

export type GoogleMailboxGrant = GoogleProfile & {
  refreshToken: string;
};

export async function exchangeGoogleCode(
  env: Env,
  code: string,
): Promise<GoogleProfile> {
  const oauth2 = createOAuthClient(env, env.GOOGLE_REDIRECT_URI);
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
  const { data } = await oauth2Api.userinfo.get();

  return {
    id: data.id ?? "",
    email: data.email ?? "",
    name: data.name ?? "",
    hd: data.hd ?? null,
  };
}

export async function exchangeGoogleMailboxCode(
  env: Env,
  code: string,
): Promise<GoogleMailboxGrant> {
  const oauth2 = createOAuthClient(env, env.GOOGLE_MAILBOX_REDIRECT_URI);
  const { tokens } = await oauth2.getToken(code);
  const refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    throw new Error(
      "Google did not return a refresh token. Reconnect with consent.",
    );
  }
  oauth2.setCredentials(tokens);

  const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
  const { data } = await oauth2Api.userinfo.get();

  return {
    id: data.id ?? "",
    email: data.email ?? "",
    name: data.name ?? "",
    hd: data.hd ?? null,
    refreshToken,
  };
}

export function oauthErrorRedirect(
  webOrigin: string,
  code: string,
  message: string,
): string {
  const params = new URLSearchParams({ error: code, message });
  return `${webOrigin.replace(/\/$/, "")}/login?${params.toString()}`;
}

export function mailboxOauthErrorRedirect(
  webOrigin: string,
  code: string,
  message: string,
): string {
  const params = new URLSearchParams({ error: code, message });
  return `${webOrigin.replace(/\/$/, "")}/settings?${params.toString()}`;
}

export function mailboxOauthSuccessRedirect(webOrigin: string): string {
  return `${webOrigin.replace(/\/$/, "")}/settings`;
}
