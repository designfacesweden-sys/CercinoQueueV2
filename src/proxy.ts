import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { GATE_COOKIE_NAME, verifyGateToken } from "@/lib/gate-token";

export async function proxy(request: NextRequest) {
  const gateHash = process.env.GATE_SECRET_SHA256;
  const sessionSecret = process.env.GATE_SESSION_SECRET;
  if (!gateHash?.trim() || !sessionSecret?.trim()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const token = request.cookies.get(GATE_COOKIE_NAME)?.value ?? "";
  const hasGate = Boolean(token && (await verifyGateToken(token, sessionSecret)));

  if (pathname === "/login") {
    if (!hasGate) return NextResponse.next();
    const rawNext = request.nextUrl.searchParams.get("next");
    const nextPath =
      rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
    return NextResponse.redirect(new URL(nextPath, request.url));
  }

  if (pathname === "/gate") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (hasGate) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
