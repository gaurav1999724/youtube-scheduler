import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { parseDriveFolderId } from "@/lib/drive-link";
import {
  DEFAULT_DRIVE_FOLDER_ID,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_PROMPT,
  type DriveAuthMode,
  type PrivacyStatus,
  type PublicSettings,
} from "@/lib/types";

const SETTINGS_ID = "default";

export type ResolvedSettings = {
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  serviceAccountJson: string;
  driveAuthMode: DriveAuthMode;
  driveFolderId: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiPrompt: string;
  dailyUploadCount: number;
  uploadTimes: string;
  timezone: string;
  privacyDefault: PrivacyStatus;
  madeForKids: boolean;
  categoryId: string;
  channelId: string;
  channelTitle: string;
  appUrl: string;
};

function envNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) return fallback;
  return parsed;
}

function prefer(dbValue: string | null | undefined, envValue: string | undefined) {
  const fromDb = dbValue?.trim();
  if (fromDb) return fromDb;
  return envValue?.trim() || "";
}

function openAiKey(stored: string | null | undefined) {
  const fromDb = stored?.trim() || "";
  const fromEnv = process.env.OPENAI_API_KEY?.trim() || "";
  if (fromDb.startsWith("sk-")) return fromDb;
  if (fromEnv.startsWith("sk-")) return fromEnv;
  return "";
}

function openAiModel(stored: string | null | undefined) {
  const model = stored?.trim() || "";
  if (!model || /^gemini/i.test(model)) return DEFAULT_OPENAI_MODEL;
  return model;
}

function resolveFolderId(value: string) {
  if (!value.trim()) return DEFAULT_DRIVE_FOLDER_ID;
  return parseDriveFolderId(value);
}

function asPrivacy(value: string | null | undefined): PrivacyStatus {
  if (value === "public" || value === "unlisted" || value === "private") return value;
  return "private";
}

function asDriveMode(value: string | null | undefined): DriveAuthMode {
  return value === "service_account" ? "service_account" : "oauth";
}

export function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function ensureSettingsRow() {
  const existing = await prisma.settings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  return prisma.settings.create({
    data: {
      id: SETTINGS_ID,
      googleClientId: process.env.GOOGLE_CLIENT_ID || null,
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
      googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || null,
      driveFolderId: resolveFolderId(process.env.DRIVE_FOLDER_ID || DEFAULT_DRIVE_FOLDER_ID),
      geminiApiKey: process.env.OPENAI_API_KEY || null,
      geminiModel: DEFAULT_OPENAI_MODEL,
      geminiPrompt: DEFAULT_OPENAI_PROMPT,
      dailyUploadCount: envNumber(process.env.DAILY_UPLOAD_COUNT, 2),
      uploadTimes: process.env.UPLOAD_TIMES || "10:00,18:00",
      timezone: process.env.TIMEZONE || "Asia/Kolkata",
    },
  });
}

export async function getResolvedSettings(): Promise<ResolvedSettings> {
  const row = await ensureSettingsRow();
  const timezone = prefer(row.timezone, process.env.TIMEZONE) || "Asia/Kolkata";
  try {
    formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  } catch {
    throw new Error(`Timezone "${timezone}" is not recognized.`);
  }
  return {
    googleClientId: prefer(row.googleClientId, process.env.GOOGLE_CLIENT_ID),
    googleClientSecret: prefer(row.googleClientSecret, process.env.GOOGLE_CLIENT_SECRET),
    googleRefreshToken: prefer(row.googleRefreshToken, process.env.GOOGLE_REFRESH_TOKEN),
    serviceAccountJson: row.serviceAccountJson?.trim() || "",
    driveAuthMode: asDriveMode(row.driveAuthMode),
    driveFolderId: resolveFolderId(prefer(row.driveFolderId, process.env.DRIVE_FOLDER_ID)),
    openaiApiKey: openAiKey(row.geminiApiKey),
    openaiModel: openAiModel(row.geminiModel),
    openaiPrompt: row.geminiPrompt?.trim() || DEFAULT_OPENAI_PROMPT,
    dailyUploadCount: row.dailyUploadCount || envNumber(process.env.DAILY_UPLOAD_COUNT, 2),
    uploadTimes: prefer(row.uploadTimes, process.env.UPLOAD_TIMES) || "10:00,18:00",
    timezone,
    privacyDefault: asPrivacy(row.privacyDefault),
    madeForKids: row.madeForKids,
    categoryId: row.categoryId || "1",
    channelId: row.channelId || "",
    channelTitle: row.channelTitle || "",
    appUrl: appUrl(),
  };
}

export function toPublicSettings(settings: ResolvedSettings): PublicSettings {
  return {
    googleClientId: settings.googleClientId,
    hasGoogleClientSecret: Boolean(settings.googleClientSecret),
    hasRefreshToken: Boolean(settings.googleRefreshToken),
    hasServiceAccount: Boolean(settings.serviceAccountJson),
    driveAuthMode: settings.driveAuthMode,
    driveFolderId: settings.driveFolderId,
    hasOpenAiKey: Boolean(settings.openaiApiKey),
    openaiModel: settings.openaiModel,
    openaiPrompt: settings.openaiPrompt,
    dailyUploadCount: settings.dailyUploadCount,
    uploadTimes: settings.uploadTimes,
    timezone: settings.timezone,
    privacyDefault: settings.privacyDefault,
    madeForKids: settings.madeForKids,
    categoryId: settings.categoryId,
    channelId: settings.channelId,
    channelTitle: settings.channelTitle,
    connected: Boolean(settings.googleRefreshToken && settings.channelTitle),
  };
}

export type SettingsUpdate = {
  googleClientId?: string;
  googleClientSecret?: string;
  googleRefreshToken?: string;
  serviceAccountJson?: string;
  driveAuthMode: DriveAuthMode;
  driveFolderId: string;
  openaiApiKey?: string;
  openaiModel: string;
  openaiPrompt: string;
  dailyUploadCount: number;
  uploadTimes: string;
  timezone: string;
  privacyDefault: PrivacyStatus;
  madeForKids: boolean;
};

export async function updateSettings(input: SettingsUpdate) {
  await ensureSettingsRow();
  try {
    formatInTimeZone(new Date(), input.timezone, "yyyy-MM-dd");
  } catch {
    throw new Error(`Timezone "${input.timezone}" is not recognized.`);
  }
  if (input.serviceAccountJson) {
    let parsed: { client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(input.serviceAccountJson);
    } catch {
      throw new Error("Service account JSON is not valid JSON.");
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("Service account JSON is missing client_email or private_key.");
    }
  }

  await prisma.settings.update({
    where: { id: SETTINGS_ID },
    data: {
      googleClientId: input.googleClientId?.trim() || null,
      ...(input.googleClientSecret?.trim()
        ? { googleClientSecret: input.googleClientSecret.trim() }
        : {}),
      ...(input.googleRefreshToken?.trim()
        ? { googleRefreshToken: input.googleRefreshToken.trim() }
        : {}),
      ...(input.serviceAccountJson?.trim()
        ? { serviceAccountJson: input.serviceAccountJson.trim() }
        : {}),
      driveAuthMode: input.driveAuthMode,
      driveFolderId: parseDriveFolderId(input.driveFolderId),
      ...(input.openaiApiKey?.trim() ? { geminiApiKey: input.openaiApiKey.trim() } : {}),
      geminiModel: openAiModel(input.openaiModel),
      geminiPrompt: input.openaiPrompt.trim(),
      dailyUploadCount: input.dailyUploadCount,
      uploadTimes: input.uploadTimes.trim(),
      timezone: input.timezone.trim(),
      privacyDefault: input.privacyDefault,
      madeForKids: input.madeForKids,
    },
  });
  return getResolvedSettings();
}

export async function saveRefreshToken(refreshToken: string) {
  await ensureSettingsRow();
  await prisma.settings.update({
    where: { id: SETTINGS_ID },
    data: { googleRefreshToken: refreshToken },
  });
}

export async function saveChannel(channelId: string, channelTitle: string) {
  await ensureSettingsRow();
  await prisma.settings.update({
    where: { id: SETTINGS_ID },
    data: { channelId, channelTitle },
  });
}
