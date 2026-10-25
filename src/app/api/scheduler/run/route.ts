import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { debug, debugError } from "@/lib/log";
import { processLibrary, uploadDueVideos } from "@/lib/pipeline";
import { errorMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  debug("upload", "request started");
  try {
    const processed = await processLibrary();
    const result = await uploadDueVideos();
    const message =
      result.uploaded || result.failed
        ? `Uploaded ${result.uploaded}. Failed ${result.failed}.`
        : processed.scheduled > 0
          ? `Nothing is due yet. ${processed.scheduled} videos are on the schedule.`
          : processed.remaining > 0
            ? `Nothing is due. ${processed.remaining} videos are still waiting to be processed, so the clock time has no video yet.`
            : "Nothing is due right now.";
    debug("upload", "request finished", result);
    return NextResponse.json({ ...result, message });
  } catch (error) {
    debugError("upload", "request failed", { error: errorMessage(error) });
    return toErrorResponse(error);
  }
}
