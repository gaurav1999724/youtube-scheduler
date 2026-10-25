import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { debug, debugError } from "@/lib/log";
import { uploadDueVideos } from "@/lib/pipeline";
import { errorMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  debug("upload", "request started");
  try {
    const result = await uploadDueVideos();
    const message =
      result.uploaded || result.failed
        ? `Uploaded ${result.uploaded}. Failed ${result.failed}.`
        : "Nothing is due right now.";
    debug("upload", "request finished", result);
    return NextResponse.json({ ...result, message });
  } catch (error) {
    debugError("upload", "request failed", { error: errorMessage(error) });
    return toErrorResponse(error);
  }
}
