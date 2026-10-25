import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { debug, debugError } from "@/lib/log";
import { processLibrary } from "@/lib/pipeline";
import { errorMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  debug("process", "request started");
  try {
    const result = await processLibrary();
    debug("process", "request finished", {
      hashed: result.hashed,
      analyzed: result.analyzed,
      scheduled: result.scheduled,
      remaining: result.remaining,
      errors: result.errors.length,
    });
    return NextResponse.json(result);
  } catch (error) {
    debugError("process", "request failed", { error: errorMessage(error) });
    return toErrorResponse(error);
  }
}
