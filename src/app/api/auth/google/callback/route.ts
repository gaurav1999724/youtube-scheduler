import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/google-auth";
import { appUrl, saveRefreshToken } from "@/lib/settings";
import { fetchYouTubeChannel } from "@/lib/youtube";
import { errorMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function settingsRedirect(params: Record<string, string>) {
  const url = new URL("/settings", appUrl());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.set("oauth_state", "", { httpOnly: true, maxAge: 0, path: "/" });
  return response;
}

export async function GET(request: NextRequest) {
  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    return settingsRedirect({ error: "Google cancelled the connection." });
  }
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expected = request.cookies.get("oauth_state")?.value;
  if (!code || !state || !expected || state !== expected) {
    return settingsRedirect({ error: "The OAuth state did not match. Try connecting again." });
  }
  try {
    const client = await getOAuthClient(null);
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return settingsRedirect({
        error: "Google did not return a refresh token. Remove AutoTube from the Google account permissions and connect again.",
      });
    }
    await saveRefreshToken(tokens.refresh_token);
    try {
      await fetchYouTubeChannel();
    } catch (error) {
      return settingsRedirect({
        error: `Connected, but the channel could not be read. ${errorMessage(error)}`.slice(0, 180),
      });
    }
    return settingsRedirect({ connected: "1" });
  } catch (error) {
    return settingsRedirect({ error: errorMessage(error).slice(0, 180) });
  }
}
