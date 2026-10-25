import fs from "fs";
import type { Video } from "@prisma/client";
import type { VideoDTO } from "@/lib/types";

type Related = { id: string; name: string; title: string | null; status?: string };

type VideoWithRelations = Video & {
  duplicateOf: Related | null;
  duplicates: Related[];
};

export function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    return [];
  }
}

export function serializeVideo(video: VideoWithRelations): VideoDTO {
  return {
    id: video.id,
    driveFileId: video.driveFileId,
    name: video.name,
    mimeType: video.mimeType,
    size: video.size,
    driveModifiedAt: video.driveModifiedAt?.toISOString() ?? null,
    hasFile: Boolean(video.localPath && fs.existsSync(video.localPath)),
    hasThumb: Boolean(video.thumbPath && fs.existsSync(video.thumbPath)),
    fingerprint: video.fingerprint,
    duplicateOfId: video.duplicateOfId,
    duplicateOf: video.duplicateOf
      ? { id: video.duplicateOf.id, name: video.duplicateOf.name, title: video.duplicateOf.title }
      : null,
    duplicates: video.duplicates.map((item) => ({
      id: item.id,
      name: item.name,
      title: item.title,
      status: item.status || "duplicate",
    })),
    isCanonical: video.isCanonical,
    status: video.status,
    title: video.title,
    description: video.description,
    tags: parseTags(video.tags),
    category: video.category,
    playlist: video.playlist,
    shortSummary: video.shortSummary,
    sortOrder: video.sortOrder,
    scheduledAt: video.scheduledAt?.toISOString() ?? null,
    privacyStatus: video.privacyStatus,
    youtubeVideoId: video.youtubeVideoId,
    uploadedAt: video.uploadedAt?.toISOString() ?? null,
    error: video.error,
    createdAt: video.createdAt.toISOString(),
  };
}

export const videoInclude = {
  duplicateOf: { select: { id: true, name: true, title: true } },
  duplicates: { select: { id: true, name: true, title: true, status: true } },
} as const;
