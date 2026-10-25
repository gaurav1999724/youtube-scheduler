import fs from "fs";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";

export function fileResponse(request: NextRequest, filePath: string, contentType: string) {
  const stat = fs.statSync(filePath);
  const range = request.headers.get("range");
  if (!range) {
    return new NextResponse(Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${stat.size}` },
    });
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : Math.min(start + 1024 * 1024 - 1, stat.size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= stat.size || end >= stat.size || start > end) {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${stat.size}` },
    });
  }
  return new NextResponse(
    Readable.toWeb(fs.createReadStream(filePath, { start, end })) as unknown as ReadableStream,
    {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    },
  );
}
