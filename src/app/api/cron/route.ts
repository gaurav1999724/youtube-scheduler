import { NextRequest, NextResponse } from "next/server";
import { debug, debugError } from "@/lib/log";
import { processLibrary, uploadDueVideos } from "@/lib/pipeline";
import { errorMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    debugError("cron", "rejected", { reason: secret ? "bad authorization" : "CRON_SECRET is not set" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  debug("cron", "started");
  try {
    const processed = await processLibrary();
    const uploaded = await uploadDueVideos();
    debug("cron", "finished", {
      hashed: processed.hashed,
      analyzed: processed.analyzed,
      scheduled: processed.scheduled,
      remaining: processed.remaining,
      processErrors: processed.errors.length,
      uploaded: uploaded.uploaded,
      uploadFailed: uploaded.failed,
      uploadSkipped: uploaded.skipped,
    });
    return NextResponse.json({ processed, uploaded });
  } catch (error) {
    debugError("cron", "failed", { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
