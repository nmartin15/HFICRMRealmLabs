import { NextResponse } from "next/server";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

export async function proxyOAuthCallback(
  request: Request,
  apiPath: string,
): Promise<NextResponse> {
  const incoming = new URL(request.url);
  const dest = new URL(apiPath, API_ORIGIN);
  dest.search = incoming.search;

  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) {
    headers.set("cookie", cookie);
  }

  const res = await fetch(dest, {
    method: "GET",
    headers,
    redirect: "manual",
  });

  const location = res.headers.get("location");
  const next = location
    ? NextResponse.redirect(location, res.status)
    : new NextResponse(await res.text(), { status: res.status });

  for (const value of res.headers.getSetCookie()) {
    next.headers.append("set-cookie", value);
  }

  return next;
}
