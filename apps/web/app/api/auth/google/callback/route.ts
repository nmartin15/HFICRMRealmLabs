import { proxyOAuthCallback } from "@/lib/proxy-oauth-callback";

export function GET(request: Request) {
  return proxyOAuthCallback(request, "/api/auth/google/callback");
}
