import fs from "fs";
import os from "os";
import path from "path";

function storageRoot() {
  const override = process.env.STORAGE_ROOT?.trim();
  if (override) return override;
  // Vercel can only write under /tmp. The deploy directory (/var/task) is read-only.
  if (process.env.VERCEL) return path.join(os.tmpdir(), "autotube");
  return path.join(process.cwd(), "storage");
}

export const STORAGE_ROOT = storageRoot();
export const VIDEO_DIR = path.join(STORAGE_ROOT, "videos");
export const THUMB_DIR = path.join(STORAGE_ROOT, "thumbs");

export function ensureStorage() {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
}

export function isInsideStorage(filePath: string) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(STORAGE_ROOT);
  return resolved === root || resolved.startsWith(root + path.sep);
}

export function extensionForMime(mime: string, name: string) {
  if (mime === "video/quicktime") return ".mov";
  if (mime === "video/x-matroska" || mime === "video/mkv") return ".mkv";
  if (mime === "video/mp4") return ".mp4";
  const ext = path.extname(name).toLowerCase();
  if (ext && ext.length <= 5) return ext;
  return ".mp4";
}

export function assertSafeDriveId(id: string) {
  if (!/^[\w-]{8,}$/.test(id)) {
    throw new Error("Unexpected Drive file id.");
  }
  return id;
}
