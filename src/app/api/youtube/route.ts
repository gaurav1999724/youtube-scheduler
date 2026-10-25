import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { fetchYouTubeChannel } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const channel = await fetchYouTubeChannel();
    return NextResponse.json({ channel });
  } catch (error) {
    return toErrorResponse(error);
  }
}
