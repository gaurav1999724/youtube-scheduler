import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, originAllowed, sessionMatches, studioSecret } from "@/lib/studio-auth";

function isPublic(pathname: string) {
  if (pathname === "/login") return true;
  if (pathname === "/api/auth/session") return true;
  if (pathname.startsWith("/api/auth/google")) return true;
  if (pathname === "/api/cron") return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    if (!originAllowed(request.headers.get("origin"), host)) {
      return NextResponse.json({ error: "This request was rejected." }, { status: 403 });
    }
  }
  if (isPublic(pathname)) return NextResponse.next();

  const secret = studioSecret();
  if (!secret) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Set APP_SECRET before using the studio." }, { status: 503 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const signedIn = await sessionMatches(request.cookies.get(SESSION_COOKIE)?.value, secret);
  if (signedIn) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
