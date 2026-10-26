export const SESSION_COOKIE = "autotube_session";
const SESSION_PAYLOAD = "autotube-session-v1";

export function studioSecret() {
  return process.env.APP_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
}

export async function sessionToken(secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(SESSION_PAYLOAD));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sessionMatches(cookie: string | undefined, secret: string) {
  if (!cookie || !secret) return false;
  const expected = await sessionToken(secret);
  if (cookie.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < cookie.length; index += 1) {
    difference |= cookie.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export function originAllowed(origin: string | null, host: string | null) {
  if (!origin) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
