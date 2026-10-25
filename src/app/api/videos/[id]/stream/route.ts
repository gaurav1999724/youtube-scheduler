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
    if (!video?.localPath || !isInsideStorage(video.localPath)) {
      return NextResponse.json({ error: "Video file is not on disk yet." }, { status: 404 });
    }
    return fileResponse(request, video.localPath, video.mimeType || "video/mp4");
  } catch (error) {
    return toErrorResponse(error);
  }
}
