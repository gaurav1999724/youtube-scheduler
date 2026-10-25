import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { uploadDueVideos } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await uploadDueVideos();
    const message =
      result.uploaded || result.failed
        ? `Uploaded ${result.uploaded}. Failed ${result.failed}.`
        : "Nothing is due right now.";
    return NextResponse.json({ ...result, message });
  } catch (error) {
    return toErrorResponse(error);
  }
}
