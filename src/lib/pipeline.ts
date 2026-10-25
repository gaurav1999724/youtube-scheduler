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
import { debug, debugError } from "@/lib/log";
import { errorMessage, type PrivacyStatus } from "@/lib/types";
import { parseTags } from "@/lib/serialize";

const ACTIVE_UPLOAD = new Set(["uploaded", "uploading"]);

function queueDecision(video: { status: string; isCanonical: boolean; title: string | null; error: string | null }) {
  if (video.status === "excluded") {
    return { inQueue: false, scheduled: false, reason: "removed from the queue" };
  }
  if (!video.isCanonical || video.status === "duplicate") {
    return { inQueue: false, scheduled: false, reason: "duplicate, kept out of the queue" };
  }
  if (video.status === "uploaded") {
    return { inQueue: false, scheduled: false, reason: "already uploaded" };
  }
  if (video.status === "uploading") {
    return { inQueue: true, scheduled: false, reason: "upload in progress" };
  }
  if (video.status === "failed") {
    return { inQueue: true, scheduled: false, reason: `failed: ${(video.error || "unknown error").slice(0, 180)}` };
  }
  if (video.status === "hashing" || video.status === "analyzing") {
    return { inQueue: true, scheduled: false, reason: `processing (${video.status})` };
  }
  if (video.status === "discovered" || !video.title) {
    return { inQueue: true, scheduled: false, reason: "in the queue, waiting to be processed" };
  }
  if (video.status === "ready") {
    return { inQueue: true, scheduled: false, reason: "processed and waiting for a slot" };
  }
  if (video.status === "scheduled") {
    return { inQueue: true, scheduled: true, reason: "already on the schedule" };
  }
  return { inQueue: false, scheduled: false, reason: `status ${video.status}` };
}

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
      debug("queue", isWinner ? "kept in the queue" : "removed from the queue", {
        video: member.name,
        status,
        inQueue: isWinner || keepLive,
        scheduled: status === "scheduled",
        reason: isWinner ? "canonical copy" : "duplicate of another file",
      });
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
  const library = await prisma.video.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      status: true,
      isCanonical: true,
      title: true,
      error: true,
      sortOrder: true,
    },
  });
  const videos = await prisma.video.findMany({
    where: { isCanonical: true, status: { in: ["ready", "scheduled"] } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  debug("schedule", "checking every video", { library: library.length, eligible: videos.length });
  const eligibleIds = new Set(videos.map((video) => video.id));
  for (const video of library) {
    if (eligibleIds.has(video.id)) continue;
    const decision = queueDecision(video);
    debug("schedule", "not scheduled", {
      video: video.name,
      status: video.status,
      inQueue: decision.inQueue,
      scheduled: false,
      sortOrder: video.sortOrder,
      reason: decision.reason,
    });
  }
  if (videos.length === 0) {
    debug("schedule", "finished with nothing to place", { library: library.length });
    return 0;
  }
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
  videos.forEach((video, index) => {
    debug("schedule", "scheduled", {
      video: video.name,
      status: "scheduled",
      inQueue: true,
      scheduled: true,
      at: slots[index].toISOString(),
      privacy: video.privacyStatus || settings.privacyDefault,
      sortOrder: video.sortOrder,
    });
  });
  debug("schedule", "finished", { scheduled: videos.length, library: library.length });
  return videos.length;
}

export async function syncDrive() {
  const settings = await getResolvedSettings();
  debug("sync", "started", { folderId: settings.driveFolderId });
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
      debug("sync", "added to the queue", { video: file.name, status: "discovered", inQueue: true, scheduled: false });
    } else {
      await prisma.video.update({ where: { id: existing.id }, data });
      updated += 1;
      debug("sync", "already in the library", {
        video: file.name,
        status: existing.status,
        inQueue: queueDecision(existing).inQueue,
        scheduled: existing.status === "scheduled",
      });
    }
  }
  debug("sync", "finished", { created, updated, total: files.length });
  return { created, updated, total: files.length };
}

export async function processLibrary() {
  const settings = await getResolvedSettings();
  const errors: { id: string; name: string; message: string }[] = [];
  let hashed = 0;
  let analyzed = 0;
  const started = Date.now();
  const budgetMs = process.env.VERCEL ? 45_000 : 0;
  const outOfTime = () => budgetMs > 0 && Date.now() - started > budgetMs;

  debug("process", "started", { budgetMs: budgetMs || "none" });
  const pendingHash = await prisma.video.findMany({
    where: {
      fingerprint: null,
      status: { notIn: ["duplicate", "excluded", "uploaded"] },
    },
    orderBy: { sortOrder: "asc" },
  });

  debug("process", "fingerprint queue", { waiting: pendingHash.length });
  for (const video of pendingHash) {
    if (outOfTime()) {
      debug("process", "stopped, request time budget reached", {
        stage: "fingerprint",
        hashed,
        left: pendingHash.length - hashed,
      });
      break;
    }
    debug("process", "processing", { video: video.name, stage: "fingerprint", status: video.status, inQueue: true, scheduled: false });
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
      debug("process", "fingerprint done", { video: video.name, status: "discovered", inQueue: true, scheduled: false });
    } catch (error) {
      const message = errorMessage(error);
      errors.push({ id: video.id, name: video.name, message });
      debugError("process", "fingerprint failed", { video: video.name, status: "failed", inQueue: true, scheduled: false, error: message });
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

  debug("process", "analysis queue", { waiting: pendingAnalysis.length });
  for (const video of pendingAnalysis) {
    if (outOfTime()) {
      debug("process", "stopped, request time budget reached", {
        stage: "analysis",
        analyzed,
        left: pendingAnalysis.length - analyzed,
      });
      break;
    }
    debug("process", "processing", { video: video.name, stage: "gemini", status: video.status, inQueue: true, scheduled: false });
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
      debug("process", "ready for a slot", { video: video.name, status: "ready", inQueue: true, scheduled: false, title: seo.title });
    } catch (error) {
      const message = errorMessage(error);
      errors.push({ id: video.id, name: video.name, message });
      debugError("process", "analysis failed", { video: video.name, status: "failed", inQueue: true, scheduled: false, error: message });
      await prisma.video.update({
        where: { id: video.id },
        data: { status: "failed", error: message.slice(0, 1000) },
      });
      await logUpload(video.id, "error", message);
    }
  }

  const scheduled = await assignSlots();
  const remaining = await prisma.video.count({
    where: {
      isCanonical: true,
      status: { in: ["discovered", "failed", "hashing", "analyzing"] },
    },
  });
  debug("process", "finished", { hashed, duplicates, analyzed, scheduled, remaining, errors: errors.length });
  return { hashed, duplicates, analyzed, scheduled, remaining, errors };
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
  const dueIds = new Set(due.map((video) => video.id));
  debug("upload", "checking scheduled videos", {
    scheduled: scheduled.length,
    due: due.length,
    cap,
    usedToday,
    timezone: settings.timezone,
  });
  for (const video of scheduled) {
    if (dueIds.has(video.id)) continue;
    debug("upload", "not due yet", {
      video: video.name,
      status: video.status,
      inQueue: true,
      scheduled: true,
      at: video.scheduledAt?.toISOString() ?? "-",
      privacy: asPrivacy(video.privacyStatus, settings.privacyDefault),
    });
  }

  let uploaded = 0;
  let failed = 0;
  let skipped = 0;

  for (let index = 0; index < due.length; index += 1) {
    const video = due[index];
    if (usedToday >= cap) {
      for (const waiting of due.slice(index)) {
        debug("upload", "not uploaded, daily cap reached", {
          video: waiting.name,
          status: waiting.status,
          inQueue: true,
          scheduled: true,
          usedToday,
          cap,
        });
        skipped += 1;
      }
      break;
    }
    const claimed = await prisma.video.updateMany({
      where: { id: video.id, status: "scheduled" },
      data: { status: "uploading", error: null },
    });
    if (claimed.count === 0) {
      debug("upload", "skipped, another run already claimed it", {
        video: video.name,
        inQueue: true,
        scheduled: true,
      });
      skipped += 1;
      continue;
    }
    usedToday += 1;
    debug("upload", "uploading", { video: video.name, status: "uploading", inQueue: true, scheduled: true });
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
      debug("upload", "uploaded", {
        video: fresh.name,
        status: "uploaded",
        inQueue: false,
        scheduled: false,
        youtubeId: result.id,
      });
    } catch (error) {
      const message = errorMessage(error);
      await prisma.video.update({
        where: { id: video.id },
        data: { status: "failed", error: message.slice(0, 1000) },
      });
      await logUpload(video.id, "error", message);
      failed += 1;
      usedToday -= 1;
      debugError("upload", "upload failed", {
        video: video.name,
        status: "failed",
        inQueue: true,
        scheduled: false,
        error: message,
      });
    }
  }

  debug("upload", "finished", { uploaded, failed, skipped, due: due.length });
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
