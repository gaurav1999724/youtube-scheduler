import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken, studioSecret } from "@/lib/studio-auth";

function passwordMatches(password: string, secret: string) {
  const given = Buffer.from(password);
  const expected = Buffer.from(secret);
  if (given.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  const secret = studioSecret();
  if (!secret) {
    return NextResponse.json({ error: "Set APP_SECRET before using the studio." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!passwordMatches(String(body.password || ""), secret)) {
    return NextResponse.json({ error: "That password is wrong." }, { status: 401 });
  }
  const token = await sessionToken(secret);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  cookies().delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
