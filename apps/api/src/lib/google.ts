import {
  CALENDAR_READONLY_SCOPE,
  GMAIL_READONLY_SCOPE,
  mailboxEmailFor,
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

/**
 * Mailbox connect reuses the login redirect URI so it works when the Google
 * OAuth client only allowlists that callback (the usual local setup).
 */
export function googleMailboxRedirectUri(
  env: Pick<Env, "GOOGLE_REDIRECT_URI">,
): string {
  return env.GOOGLE_REDIRECT_URI;
}

export function googleMailboxUrl(
  env: Env,
  state: string,
  mailbox: Mailbox,
): string {
  const oauth2 = createOAuthClient(env, googleMailboxRedirectUri(env));
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    hd: env.ALLOWED_HOSTED_DOMAIN,
    scope: [
      "openid",
      "email",
      GMAIL_READONLY_SCOPE,
      CALENDAR_READONLY_SCOPE,
    ],
    state,
    login_hint: mailboxEmailFor(mailbox),
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

type GoogleTokenError = {
  message?: string;
  response?: {
    data?: {
      error?: string;
      error_description?: string;
    };
  };
};

export function googleAuthErrorMessage(err: unknown): string {
  if (!err || typeof err !== "object") {
    return "Google sign-in failed";
  }
  const googleErr = err as GoogleTokenError;
  const code = googleErr.response?.data?.error ?? googleErr.message;
  if (code === "invalid_client") {
    return "Google rejected the OAuth client secret. Copy GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from the same Web client in Google Cloud Console, then restart the API.";
  }
  return (
    googleErr.response?.data?.error_description ??
    googleErr.message ??
    "Google sign-in failed"
  );
}

async function exchangeCode(env: Env, redirectUri: string, code: string) {
  const oauth2 = createOAuthClient(env, redirectUri);
  try {
    return { oauth2, tokens: (await oauth2.getToken(code)).tokens };
  } catch (err) {
    throw new Error(googleAuthErrorMessage(err));
  }
}

export async function exchangeGoogleCode(
  env: Env,
  code: string,
): Promise<GoogleProfile> {
  const { oauth2, tokens } = await exchangeCode(
    env,
    env.GOOGLE_REDIRECT_URI,
    code,
  );
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
  const { oauth2, tokens } = await exchangeCode(
    env,
    googleMailboxRedirectUri(env),
    code,
  );
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
