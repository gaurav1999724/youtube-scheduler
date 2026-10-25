import fs from "fs";
import path from "path";
import type { Video } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getResolvedSettings } from "@/lib/settings";
import { downloadDriveFile, listDriveVideos } from "@/lib/google-drive";
import { generateVideoFingerprint, groupByFingerprint } from "@/lib/deduplicator";
import { probeDuration, transcodeToMp4, writeThumbnail } from "@/lib/media";
import { analyzeVideoWithGemini } from "@/lib/gemini";
import { uploadToYouTube } from "@/lib/youtube";
import { formatInTimeZone } from "date-fns-tz";
import {
  dayBounds,
  generateSlots,
  PUBLIC_EARLY_WINDOW_MS,
  uploadCapForDate,
  type DayPlanSlot,
} from "@/lib/scheduler";
import {
  assertSafeDriveId,
  ensureStorage,
  extensionForMime,
  VIDEO_DIR,
  THUMB_DIR,
} from "@/lib/paths";
import { errorMessage, type PrivacyStatus } from "@/lib/types";
import { parseTags } from "@/lib/serialize";

const ACTIVE_UPLOAD = new Set(["uploaded", "uploading"]);

async function logUpload(videoId: string, action: string, message: string) {
  await prisma.uploadLog.create({
    data: { videoId, action, message: message.slice(0, 2000) },
  });
}

function isMkv(mime: string, filePath: string) {
  return mime === "video/x-matroska" || mime === "video/mkv" || filePath.toLowerCase().endsWith(".mkv");
}

async function maybeTranscode(videoId: string, filePath: string, mime: string) {
  if (!isMkv(mime, filePath)) return filePath;
  const output = path.join(VIDEO_DIR, `${path.basename(filePath, path.extname(filePath))}.mp4`);
  await transcodeToMp4(filePath, output);
  if (path.resolve(filePath) !== path.resolve(output) && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  await prisma.video.update({
    where: { id: videoId },
    data: { localPath: output, mimeType: "video/mp4" },
  });
  return output;
}

export async function ensureLocalFile(video: Video) {
  ensureStorage();
  if (video.localPath && fs.existsSync(video.localPath)) {
    return maybeTranscode(video.id, video.localPath, video.mimeType);
  }
  assertSafeDriveId(video.driveFileId);
  const dest = path.join(VIDEO_DIR, `${video.driveFileId}${extensionForMime(video.mimeType, video.name)}`);
  await downloadDriveFile(video.driveFileId, dest);
  await prisma.video.update({
    where: { id: video.id },
    data: { localPath: dest },
  });
  return maybeTranscode(video.id, dest, video.mimeType);
}

async function writeThumb(videoId: string, filePath: string) {
  const duration = await probeDuration(filePath).catch(() => 0);
  const at = duration > 0.2 ? Math.min(duration * 0.1, duration - 0.05) : 0;
  const thumbPath = path.join(THUMB_DIR, `${videoId}.jpg`);
  await writeThumbnail(filePath, thumbPath, at);
  await prisma.video.update({ where: { id: videoId }, data: { thumbPath } });
  return duration;
}

function pickWinner(group: Video[]) {
  return [...group].sort((a, b) => {
    const aLive = ACTIVE_UPLOAD.has(a.status) ? 1 : 0;
    const bLive = ACTIVE_UPLOAD.has(b.status) ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    const aSize = BigInt(a.size || "0");
    const bSize = BigInt(b.size || "0");
    if (aSize !== bSize) return aSize > bSize ? -1 : 1;
    const aTime = a.driveModifiedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.driveModifiedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    return a.id < b.id ? -1 : 1;
  })[0];
}

export async function clusterVideos() {
  const videos = await prisma.video.findMany({
    where: { fingerprint: { not: null }, status: { not: "excluded" } },
  });
  const groups = groupByFingerprint(
    videos
      .filter((video) => video.fingerprint)
      .map((video) => ({ id: video.id, fingerprint: video.fingerprint! })),
  );
  const byId = new Map(videos.map((video) => [video.id, video]));
  let duplicates = 0;

  for (const ids of groups) {
    const members = ids.map((id) => byId.get(id)).filter((video): video is Video => Boolean(video));
    if (members.length === 0) continue;
    const winner = pickWinner(members);
    for (const member of members) {
      const isWinner = member.id === winner.id;
      if (!isWinner) duplicates += 1;
      const keepLive = ACTIVE_UPLOAD.has(member.status);
      const status = isWinner
        ? member.status === "duplicate"
          ? member.title
            ? "ready"
            : "discovered"
          : member.status
        : keepLive
          ? member.status
          : "duplicate";
      await prisma.video.update({
        where: { id: member.id },
        data: {
          isCanonical: isWinner,
          duplicateOfId: isWinner ? null : winner.id,
          status,
          scheduledAt: isWinner || keepLive ? member.scheduledAt : null,
        },
      });
    }
  }
  return duplicates;
}

export async function loadDayPlans(): Promise<DayPlanSlot[]> {
  const plans = await prisma.dayPlan.findMany({ orderBy: { date: "asc" } });
  return plans.map((plan) => ({ date: plan.date, times: plan.times }));
}

export async function assignSlots() {
  const settings = await getResolvedSettings();
  const videos = await prisma.video.findMany({
    where: { isCanonical: true, status: { in: ["ready", "scheduled"] } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (videos.length === 0) return 0;
  const slots = generateSlots(settings, videos.length, await loadDayPlans());
  await prisma.$transaction(
    videos.map((video, index) =>
      prisma.video.update({
        where: { id: video.id },
        data: {
          status: "scheduled",
          scheduledAt: slots[index],
          privacyStatus: video.privacyStatus || settings.privacyDefault,
        },
      }),
    ),
  );
  return videos.length;
}

export async function syncDrive() {
  const settings = await getResolvedSettings();
  const files = await listDriveVideos(settings.driveFolderId);
  const maxOrder = await prisma.video.aggregate({ _max: { sortOrder: true } });
  let order = (maxOrder._max.sortOrder ?? -1) + 1;
  let created = 0;
  let updated = 0;
  for (const file of files) {
    const existing = await prisma.video.findUnique({ where: { driveFileId: file.id } });
    const data = {
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      driveModifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
    };
    if (!existing) {
      await prisma.video.create({
        data: {
          ...data,
          driveFileId: file.id,
          sortOrder: order,
          status: "discovered",
          isCanonical: true,
        },
      });
      order += 1;
      created += 1;
    } else {
      await prisma.video.update({ where: { id: existing.id }, data });
      updated += 1;
    }
  }
  return { created, updated, total: files.length };
}

export async function processLibrary() {
  const settings = await getResolvedSettings();
  const errors: { id: string; name: string; message: string }[] = [];
  let hashed = 0;
  let analyzed = 0;

  const pendingHash = await prisma.video.findMany({
    where: {
      fingerprint: null,
      status: { notIn: ["duplicate", "excluded", "uploaded"] },
    },
    orderBy: { sortOrder: "asc" },
  });

  for (const video of pendingHash) {
    try {
      await prisma.video.update({
        where: { id: video.id },
        data: { status: "hashing", error: null },
      });
      const filePath = await ensureLocalFile(video);
      const duration = await writeThumb(video.id, filePath).catch(async () => {
        return probeDuration(filePath).catch(() => 0);
      });
      const fingerprint = await generateVideoFingerprint(filePath, duration);
      await prisma.video.update({
        where: { id: video.id },
        data: { fingerprint, status: "discovered", localPath: filePath },
      });
      hashed += 1;
    } catch (error) {
      const message = errorMessage(error);
      errors.push({ id: video.id, name: video.name, message });
      await prisma.video.update({
        where: { id: video.id },
        data: { status: "failed", error: message.slice(0, 1000) },
      });
      await logUpload(video.id, "error", message);
    }
  }

  const duplicates = await clusterVideos();

  const pendingAnalysis = await prisma.video.findMany({
    where: {
      isCanonical: true,
      title: null,
      fingerprint: { not: null },
      status: { notIn: ["duplicate", "excluded", "uploaded", "uploading"] },
    },
    orderBy: { sortOrder: "asc" },
  });

  for (const video of pendingAnalysis) {
    try {
      if (!settings.geminiApiKey) {
        throw new Error("Gemini API key is not configured.");
      }
      await prisma.video.update({
        where: { id: video.id },
        data: { status: "analyzing", error: null },
      });
      const fresh = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
      const filePath = await ensureLocalFile(fresh);
      const seo = await analyzeVideoWithGemini(filePath, {
        mimeType: filePath.endsWith(".mp4") ? "video/mp4" : fresh.mimeType,
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
        prompt: settings.geminiPrompt,
      });
      await prisma.video.update({
        where: { id: video.id },
        data: {
          status: "ready",
          title: seo.title,
          description: seo.description,
          tags: JSON.stringify(seo.tags),
          category: seo.category,
          playlist: seo.playlist,
          shortSummary: seo.shortSummary,
          localPath: filePath,
          error: null,
        },
      });
      await logUpload(video.id, "analyze", seo.title);
      analyzed += 1;
    } catch (error) {
      const message = errorMessage(error);
      errors.push({ id: video.id, name: video.name, message });
      await prisma.video.update({
        where: { id: video.id },
        data: { status: "failed", error: message.slice(0, 1000) },
      });
      await logUpload(video.id, "error", message);
    }
  }

  const scheduled = await assignSlots();
  return { hashed, duplicates, analyzed, scheduled, errors };
}

function asPrivacy(value: string | null | undefined, fallback: PrivacyStatus): PrivacyStatus {
  if (value === "public" || value === "unlisted" || value === "private") return value;
  return fallback;
}

export async function uploadDueVideos() {
  const settings = await getResolvedSettings();
  const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await prisma.video.updateMany({
    where: { status: "uploading", updatedAt: { lt: staleBefore } },
    data: {
      status: "scheduled",
      error: "The previous upload timed out and was returned to the queue.",
    },
  });

  const { start, end } = dayBounds(settings.timezone);
  const today = formatInTimeZone(new Date(), settings.timezone, "yyyy-MM-dd");
  const cap = uploadCapForDate(today, settings, await loadDayPlans());
  let usedToday = await prisma.video.count({
    where: {
      OR: [
        { status: "uploading" },
        { status: "uploaded", uploadedAt: { gte: start, lte: end } },
      ],
    },
  });

  const scheduled = await prisma.video.findMany({
    where: { status: "scheduled", isCanonical: true, scheduledAt: { not: null } },
    orderBy: { scheduledAt: "asc" },
  });
  const now = Date.now();
  const due = scheduled.filter((video) => {
    const at = video.scheduledAt?.getTime() ?? 0;
    const privacy = asPrivacy(video.privacyStatus, settings.privacyDefault);
    if (privacy === "public") return at <= now + PUBLIC_EARLY_WINDOW_MS;
    return at <= now;
  });

  let uploaded = 0;
  let failed = 0;
  let skipped = 0;

  for (const video of due) {
    if (usedToday >= cap) {
      skipped += due.length - (uploaded + failed + skipped);
      break;
    }
    const claimed = await prisma.video.updateMany({
      where: { id: video.id, status: "scheduled" },
      data: { status: "uploading", error: null },
    });
    if (claimed.count === 0) {
      skipped += 1;
      continue;
    }
    usedToday += 1;
    try {
      const fresh = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
      const filePath = await ensureLocalFile(fresh);
      const privacy = asPrivacy(fresh.privacyStatus, settings.privacyDefault);
      const tags = parseTags(fresh.tags);
      const result = await uploadToYouTube({
        videoPath: filePath,
        title: fresh.title || fresh.name,
        description: fresh.description || "",
        tags,
        categoryId: settings.categoryId,
        privacy,
        scheduledAt: fresh.scheduledAt,
        madeForKids: settings.madeForKids,
        playlist: fresh.playlist,
      });
      await prisma.video.update({
        where: { id: fresh.id },
        data: {
          status: "uploaded",
          youtubeVideoId: result.id,
          uploadedAt: new Date(),
          localPath: filePath,
          error: result.playlistWarning ? result.playlistWarning.slice(0, 1000) : null,
        },
      });
      await logUpload(
        fresh.id,
        "upload",
        result.playlistWarning
          ? `YouTube id ${result.id}. Playlist was not updated: ${result.playlistWarning}`
          : `YouTube id ${result.id}`,
      );
      uploaded += 1;
    } catch (error) {
      const message = errorMessage(error);
      await prisma.video.update({
        where: { id: video.id },
        data: { status: "failed", error: message.slice(0, 1000) },
      });
      await logUpload(video.id, "error", message);
      failed += 1;
      usedToday -= 1;
    }
  }

  return { uploaded, failed, skipped };
}

export async function promoteVideo(id: string) {
  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) throw new Error("Video not found.");
  if (ACTIVE_UPLOAD.has(video.status)) {
    throw new Error("This video has already been uploaded.");
  }
  if (video.duplicateOfId) {
    const previous = await prisma.video.findUnique({ where: { id: video.duplicateOfId } });
    if (previous && ACTIVE_UPLOAD.has(previous.status)) {
      throw new Error("A copy of this video is already uploaded, so this duplicate stays out of the queue.");
    }
  }
  await prisma.$transaction(async (tx) => {
    if (video.duplicateOfId) {
      await tx.video.updateMany({
        where: {
          OR: [{ id: video.duplicateOfId }, { duplicateOfId: video.duplicateOfId }],
          NOT: { id: video.id },
          status: { notIn: ["uploaded", "uploading"] },
        },
        data: { isCanonical: false, duplicateOfId: video.id, status: "duplicate", scheduledAt: null },
      });
    }
    await tx.video.update({
      where: { id: video.id },
      data: {
        isCanonical: true,
        duplicateOfId: null,
        status: video.title ? "ready" : "discovered",
        error: null,
      },
    });
  });
  if (video.title) await assignSlots();
}

export async function excludeVideo(id: string) {
  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) throw new Error("Video not found.");
  if (ACTIVE_UPLOAD.has(video.status)) {
    throw new Error("Uploaded videos stay in the library.");
  }
  await prisma.video.update({
    where: { id },
    data: { status: "excluded", isCanonical: false, scheduledAt: null },
  });
  await assignSlots();
}

export async function retryVideo(id: string) {
  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) throw new Error("Video not found.");
  await prisma.video.update({
    where: { id },
    data: {
      status: video.title ? "ready" : "discovered",
      error: null,
      isCanonical: true,
      duplicateOfId: null,
    },
  });
  if (video.title) await assignSlots();
}

export async function reorderQueue(ids: string[]) {
  await prisma.$transaction(
    async (tx) => {
      for (let index = 0; index < ids.length; index += 1) {
        await tx.video.update({ where: { id: ids[index] }, data: { sortOrder: index } });
      }
    },
    { timeout: 20000 },
  );
  await assignSlots();
}
