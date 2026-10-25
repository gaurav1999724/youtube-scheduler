import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { debug, debugError } from "@/lib/log";
import { uploadNextVideo } from "@/lib/pipeline";
import { errorMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  debug("upload-now", "request started");
  try {
    const result = await uploadNextVideo();
    debug("upload-now", "request finished", { video: result.name, youtubeId: result.youtubeVideoId });
    return NextResponse.json(result);
  } catch (error) {
    debugError("upload-now", "request failed", { error: errorMessage(error) });
    return toErrorResponse(error);
  }
}
