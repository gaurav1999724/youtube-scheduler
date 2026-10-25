import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/http";
import { reorderQueue } from "@/lib/pipeline";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

export async function POST(request: NextRequest) {
  try {
    const { ids } = schema.parse(await request.json());
    const found = await prisma.video.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== new Set(ids).size) {
      return NextResponse.json({ error: "One of those videos is missing." }, { status: 400 });
    }
    await reorderQueue(ids);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
