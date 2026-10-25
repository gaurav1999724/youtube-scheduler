import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { getResolvedSettings, toPublicSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = toPublicSettings(await getResolvedSettings());
    const [total, duplicates, processed, queued, uploaded, recent, logs] = await Promise.all([
      prisma.video.count(),
      prisma.video.count({ where: { status: "duplicate" } }),
      prisma.video.count({ where: { title: { not: null } } }),
      prisma.video.count({ where: { status: { in: ["ready", "scheduled"] }, isCanonical: true } }),
      prisma.video.count({ where: { status: "uploaded" } }),
      prisma.video.findMany({
        where: { status: "uploaded" },
        orderBy: { uploadedAt: "desc" },
        take: 6,
        select: { id: true, title: true, name: true, uploadedAt: true, youtubeVideoId: true },
      }),
      prisma.uploadLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { video: { select: { name: true, title: true } } },
      }),
    ]);
    return NextResponse.json({
      total,
      duplicates,
      processed,
      queued,
      uploaded,
      channel: {
        connected: settings.connected,
        channelId: settings.channelId,
        channelTitle: settings.channelTitle,
      },
      recent: recent.map((video) => ({
        ...video,
        uploadedAt: video.uploadedAt?.toISOString() ?? null,
      })),
      logs: logs.map((entry) => ({
        id: entry.id,
        action: entry.action,
        message: entry.message,
        createdAt: entry.createdAt.toISOString(),
        videoName: entry.video.title || entry.video.name,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
