import { google } from "googleapis";
import { GOOGLE_SCOPES } from "@/lib/types";
import { getResolvedSettings } from "@/lib/settings";

export async function getOAuthClient(refreshToken?: string | null) {
  const settings = await getResolvedSettings();
  if (!settings.googleClientId || !settings.googleClientSecret) {
    throw new Error("Google OAuth client id and secret are required. Save them in Settings first.");
  }
  const client = new google.auth.OAuth2(
    settings.googleClientId,
    settings.googleClientSecret,
    `${settings.appUrl}/api/auth/google/callback`,
  );
  const token = refreshToken === undefined ? settings.googleRefreshToken : refreshToken;
  if (token) client.setCredentials({ refresh_token: token });
  return client;
}

export async function getAuthorizedYouTube() {
  const settings = await getResolvedSettings();
  if (!settings.googleRefreshToken) {
    throw new Error("YouTube is not connected. Use Connect YouTube in Settings.");
  }
  const auth = await getOAuthClient(settings.googleRefreshToken);
  return google.youtube({ version: "v3", auth });
}

export async function getDriveClient() {
  const settings = await getResolvedSettings();
  if (settings.driveAuthMode === "service_account") {
    if (!settings.serviceAccountJson) {
      throw new Error("Service account JSON is not configured.");
    }
    let credentials: { client_email?: string; private_key?: string };
    try {
      credentials = JSON.parse(settings.serviceAccountJson);
    } catch {
      throw new Error("Service account JSON is not valid JSON.");
    }
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("Service account JSON is missing client_email or private_key.");
    }
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    return google.drive({ version: "v3", auth });
  }
  if (!settings.googleRefreshToken) {
    throw new Error("Connect YouTube OAuth before syncing Drive, or switch Drive to a service account.");
  }
  const auth = await getOAuthClient(settings.googleRefreshToken);
  return google.drive({ version: "v3", auth });
}

export function buildConsentUrl(client: InstanceType<typeof google.auth.OAuth2>, state: string) {
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
    include_granted_scopes: true,
  });
}
