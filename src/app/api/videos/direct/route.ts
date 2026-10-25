import path from "path";
import { NextResponse } from "next/server";
import { assembleUpload, assertVideoFile, saveChunk } from "@/lib/incoming";
import { toErrorResponse } from "@/lib/http";
import { debug, debugError } from "@/lib/log";
import { publishManualVideo } from "@/lib/pipeline";
import { errorMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const type = request.headers.get("content-type") || "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const uploadId = String(form.get("uploadId") || "");
      const index = Number(form.get("index"));
      const chunk = form.get("chunk");
      if (!(chunk instanceof File)) throw new Error("The video chunk is missing.");
      const bytes = Buffer.from(await chunk.arrayBuffer());
      await saveChunk(uploadId, index, bytes);
      debug("direct", "chunk stored", { uploadId, index, bytes: bytes.length });
      return NextResponse.json({ ok: true, index });
    }

    const body = (await request.json()) as { uploadId?: string; total?: number; name?: string; mimeType?: string };
    const uploadId = String(body.uploadId || "");
    const total = Number(body.total);
    const name = path.basename(String(body.name || "video.mp4"));
    const mimeType = String(body.mimeType || "video/mp4");
    assertVideoFile(name, mimeType);
    debug("direct", "assembling upload", { uploadId, name, total });
    const assembled = await assembleUpload(uploadId, total, name, mimeType);
    const result = await publishManualVideo({
      filePath: assembled.filePath,
      name,
      mimeType,
      size: assembled.size,
    });
    debug("direct", "request finished", { video: result.name, youtubeId: result.youtubeVideoId });
    return NextResponse.json(result);
  } catch (error) {
    debugError("direct", "request failed", { error: errorMessage(error) });
    return toErrorResponse(error);
  }
}
