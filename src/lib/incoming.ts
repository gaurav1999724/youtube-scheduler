import fs from "fs";
import path from "path";
import { ensureStorage, extensionForMime, STORAGE_ROOT, VIDEO_DIR } from "@/lib/paths";

export const INCOMING_DIR = path.join(STORAGE_ROOT, "incoming");
export const CHUNK_BYTES = 3 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_VIDEO_BYTES / CHUNK_BYTES);

const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);

export function assertUploadId(id: string) {
  if (!UPLOAD_ID.test(id)) throw new Error("That upload id is not valid.");
  return id;
}

export function assertVideoFile(name: string, mime: string) {
  const ext = path.extname(name).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(ext)) {
    throw new Error("Use an mp4, mov, mkv, webm, m4v, or avi file.");
  }
  if (mime && mime !== "application/octet-stream" && !mime.startsWith("video/")) {
    throw new Error("Choose a video file.");
  }
}

export async function saveChunk(uploadId: string, index: number, data: Buffer) {
  assertUploadId(uploadId);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) {
    throw new Error("That chunk is out of range.");
  }
  if (data.length === 0 || data.length > CHUNK_BYTES) {
    throw new Error("That chunk is too large.");
  }
  const dir = path.join(INCOMING_DIR, uploadId);
  fs.mkdirSync(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, String(index)), data);
}

export async function assembleUpload(uploadId: string, total: number, name: string, mime: string) {
  assertUploadId(uploadId);
  if (!Number.isInteger(total) || total < 1 || total > MAX_CHUNKS) {
    throw new Error("That upload is incomplete.");
  }
  const dir = path.join(INCOMING_DIR, uploadId);
  let size = 0;
  for (let index = 0; index < total; index += 1) {
    const part = path.join(dir, String(index));
    if (!fs.existsSync(part)) throw new Error(`Chunk ${index + 1} of ${total} did not arrive.`);
    size += fs.statSync(part).size;
  }
  if (size > MAX_VIDEO_BYTES) throw new Error("This video is larger than 2 GB.");
  ensureStorage();
  const dest = path.join(VIDEO_DIR, `${uploadId}${extensionForMime(mime, name)}`);
  await fs.promises.writeFile(dest, Buffer.alloc(0));
  for (let index = 0; index < total; index += 1) {
    const bytes = await fs.promises.readFile(path.join(dir, String(index)));
    await fs.promises.appendFile(dest, bytes);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { filePath: dest, size };
}
