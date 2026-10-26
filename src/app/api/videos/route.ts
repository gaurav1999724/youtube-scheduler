import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { serializeVideo, videoInclude } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const videos = await prisma.video.findMany({
      include: videoInclude,
      orderBy: [{ queueScore: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ videos: videos.map(serializeVideo) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
