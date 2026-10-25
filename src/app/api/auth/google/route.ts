import crypto from "crypto";
import { NextResponse } from "next/server";
import { buildConsentUrl, getOAuthClient } from "@/lib/google-auth";
import { appUrl } from "@/lib/settings";
import { errorMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = crypto.randomBytes(24).toString("hex");
    const client = await getOAuthClient(null);
    const url = buildConsentUrl(client, state);
    const response = NextResponse.redirect(url);
    response.cookies.set("oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.APP_URL?.startsWith("https://") ?? false,
      maxAge: 600,
      path: "/",
    });
    return response;
  } catch (error) {
    const url = new URL("/settings", appUrl());
    url.searchParams.set("error", errorMessage(error).slice(0, 180));
    return NextResponse.redirect(url);
  }
}
