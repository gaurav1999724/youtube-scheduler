import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseDriveFolderId } from "@/lib/drive-link";
import { toErrorResponse } from "@/lib/http";
import { getResolvedSettings, toPublicSettings, updateSettings } from "@/lib/settings";
import { errorMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  googleClientId: z.string().max(300).optional(),
  googleClientSecret: z.string().max(300).optional(),
  googleRefreshToken: z.string().max(500).optional(),
  serviceAccountJson: z.string().max(200_000).optional(),
  driveAuthMode: z.enum(["oauth", "service_account"]),
  driveFolderId: z.string().min(8).max(500),
  geminiApiKey: z.string().max(300).optional(),
  geminiModel: z.string().min(2).max(80),
  geminiPrompt: z.string().min(20).max(8000),
  dailyUploadCount: z.number().int().min(1).max(12),
  uploadTimes: z
    .string()
    .regex(/^(\d{1,2}:\d{2})(\s*,\s*\d{1,2}:\d{2})*$/, "Use times like 10:00,18:00."),
  timezone: z.string().min(1).max(80),
  privacyDefault: z.enum(["private", "unlisted", "public"]),
  madeForKids: z.boolean(),
});

export async function GET() {
  try {
    const settings = await getResolvedSettings();
    return NextResponse.json({ settings: toPublicSettings(settings) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = updateSchema.parse(await request.json());
    let driveFolderId = "";
    try {
      driveFolderId = parseDriveFolderId(body.driveFolderId);
    } catch (error) {
      return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
    }
    const settings = await updateSettings({ ...body, driveFolderId });
    return NextResponse.json({ settings: toPublicSettings(settings) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
