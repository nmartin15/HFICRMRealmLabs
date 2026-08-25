import { google, type Auth } from "googleapis";
import type { Env } from "../env.js";

export function googleClientFromRefreshToken(
  env: Env,
  refreshToken: string,
): Auth.OAuth2Client {
  const oauth2 = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

