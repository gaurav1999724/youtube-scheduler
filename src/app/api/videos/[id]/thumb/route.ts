import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { isInsideStorage } from "@/lib/paths";
import { fileResponse } from "@/lib/stream-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const video = await prisma.video.findUnique({ where: { id: params.id } });
    if (!video?.thumbPath || !isInsideStorage(video.thumbPath)) {
      return NextResponse.json({ error: "Thumbnail is not ready." }, { status: 404 });
    }
    return fileResponse(request, video.thumbPath, "image/jpeg");
  } catch (error) {
    return toErrorResponse(error);
  }
}
