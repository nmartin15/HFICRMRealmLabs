import { sessionCookieName } from "@realm-labs/contracts";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = new Set(["/login"]);

function apiReplayApp(): string {
  return process.env.FLY_API_APP ?? "";
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const flyApiApp = apiReplayApp();

  if (flyApiApp && (pathname.startsWith("/api") || pathname === "/health")) {
    return new NextResponse(null, {
      status: 200,
      headers: {
        "fly-replay": `app=${flyApiApp}`,
      },
    });
  }

  if (pathname.startsWith("/api") || pathname === "/health") {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get(sessionCookieName)?.value);
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
