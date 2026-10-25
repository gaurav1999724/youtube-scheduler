import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { serializeVideo, videoInclude } from "@/lib/serialize";
import { excludeVideo, promoteVideo, retryVideo } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().max(100).optional(),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().max(80)).max(30).optional(),
  playlist: z.string().max(150).optional(),
  privacyStatus: z.enum(["private", "unlisted", "public"]).optional(),
  promote: z.boolean().optional(),
  exclude: z.boolean().optional(),
  retry: z.boolean().optional(),
});

async function load(id: string) {
  const video = await prisma.video.findUnique({ where: { id }, include: videoInclude });
  if (!video) return null;
  return serializeVideo(video);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const existing = await prisma.video.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Video not found." }, { status: 404 });
    const body = patchSchema.parse(await request.json());
    if (body.promote) await promoteVideo(params.id);
    else if (body.exclude) await excludeVideo(params.id);
    else if (body.retry) await retryVideo(params.id);
    else {
      await prisma.video.update({
        where: { id: params.id },
        data: {
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.tags !== undefined
            ? { tags: JSON.stringify(body.tags.map((tag) => tag.trim()).filter(Boolean)) }
            : {}),
          ...(body.playlist !== undefined ? { playlist: body.playlist.trim() } : {}),
          ...(body.privacyStatus !== undefined ? { privacyStatus: body.privacyStatus } : {}),
        },
      });
    }
    const video = await load(params.id);
    return NextResponse.json({ video });
  } catch (error) {
    return toErrorResponse(error);
  }
}
