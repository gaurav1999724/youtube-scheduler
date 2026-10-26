import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { Video } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getResolvedSettings } from "@/lib/settings";
import { downloadDriveFile, listDriveVideos } from "@/lib/google-drive";
import { generateVideoFingerprint, groupByFingerprint } from "@/lib/deduplicator";
import { probeDuration, transcodeToMp4, writeThumbnail, ensureVerticalShort } from "@/lib/media";
import { analyzeVideoWithOpenAI } from "@/lib/openai";
import { uploadToYouTube, classifyDuration, shapeForYouTube } from "@/lib/youtube";
import { resolveDuration, savedLength } from "@/lib/queue-order";
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
const MANUAL_DRIVE_PREFIX = "manual-";
const notManual = { NOT: { driveFileId: { startsWith: MANUAL_DRIVE_PREFIX } } };
const longestFirst = [{ queueScore: "desc" as const }, { createdAt: "asc" as const }];

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
    where: { isCanonical: true, status: { in: ["ready", "scheduled"] }, ...notManual },
    orderBy: longestFirst,
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

async function fileForYouTube(filePath: string, length: "short" | "standard", name: string) {
  if (length !== "short") return filePath;
  debug("upload", "rendering a vertical Short", { video: name });
  return ensureVerticalShort(filePath);
}

async function markLengthUnread(video: { id: string; name: string }, filePath?: string) {
  const message = "Could not read this video's length, so it was not uploaded.";
  await prisma.video.update({
    where: { id: video.id },
    data: {
      status: "failed",
      error: message,
      queueScore: -1,
      ...(filePath ? { localPath: filePath } : {}),
    },
  });
  await logUpload(video.id, "error", message);
  debugError("process", "length unreadable", { video: video.name });
}

async function rankDriveVideosByDuration() {
  await prisma.$executeRaw`
    WITH scored AS (
      SELECT
        id,
        "createdAt",
        CASE
          WHEN ("durationSeconds" IS NULL OR "durationSeconds" <= 0) AND status = 'failed' THEN -1
          WHEN "durationSeconds" >= 10 THEN 1000000000 + "durationSeconds"
          WHEN "durationSeconds" IS NULL OR "durationSeconds" <= 0 THEN
            100000000 + LEAST(
              COALESCE(
                CASE WHEN "size" ~ '^[0-9]+([.][0-9]+)?$' THEN "size"::double precision ELSE 0 END,
                0
              ) / 1048576,
              800000000
            )
          ELSE "durationSeconds"
        END AS score
      FROM autotube."Video"
      WHERE "driveFileId" NOT LIKE 'manual-%'
    ),
    ranked AS (
      SELECT id, score, (ROW_NUMBER() OVER (ORDER BY score DESC, "createdAt" ASC) - 1)::int AS next_order
      FROM scored
    )
    UPDATE autotube."Video" AS v
    SET "queueScore" = ranked.score,
        "sortOrder" = ranked.next_order
    FROM ranked
    WHERE v.id = ranked.id
      AND (v."queueScore" IS DISTINCT FROM ranked.score OR v."sortOrder" IS DISTINCT FROM ranked.next_order)
  `;
}

export async function syncDrive() {
  const settings = await getResolvedSettings();
  debug("sync", "started", { folderId: settings.driveFolderId });
  const files = await listDriveVideos(settings.driveFolderId);
  const existingIds = new Set<string>();
  for (let index = 0; index < files.length; index += 500) {
    const slice = files.slice(index, index + 500).map((file) => file.id);
    const rows = await prisma.video.findMany({
      where: { driveFileId: { in: slice } },
      select: { driveFileId: true },
    });
    for (const row of rows) existingIds.add(row.driveFileId);
  }

  let created = 0;
  let updated = 0;
  for (let index = 0; index < files.length; index += 200) {
    const chunk = files.slice(index, index + 200);
    const fresh = chunk.filter((file) => !existingIds.has(file.id));
    const known = chunk.filter((file) => existingIds.has(file.id));
    if (fresh.length > 0) {
      await prisma.video.createMany({
        data: fresh.map((file) => ({
          driveFileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          driveModifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
          durationSeconds: file.durationSeconds,
          queueScore: 0,
          sortOrder: 0,
          status: "discovered",
          isCanonical: true,
        })),
        skipDuplicates: true,
      });
      created += fresh.length;
    }
    if (known.length > 0) {
      const ids = known.map((file) => file.id);
      const names = known.map((file) => file.name);
      const mimes = known.map((file) => file.mimeType);
      const sizes = known.map((file) => file.size);
      const modified = known.map((file) => (file.modifiedTime ? new Date(file.modifiedTime) : null));
      const durations = known.map((file) => file.durationSeconds);
      await prisma.$executeRaw`
        UPDATE autotube."Video" AS v
        SET
          name = data.name,
          "mimeType" = data.mime,
          size = data.size,
          "driveModifiedAt" = data.modified,
          "durationSeconds" = COALESCE(v."durationSeconds", data.duration)
        FROM (
          SELECT * FROM unnest(
            ${ids}::text[],
            ${names}::text[],
            ${mimes}::text[],
            ${sizes}::text[],
            ${modified}::timestamptz[],
            ${durations}::float8[]
          ) AS t(drive_id, name, mime, size, modified, duration)
        ) AS data
        WHERE v."driveFileId" = data.drive_id
      `;
      updated += known.length;
    }
  }

  await rankDriveVideosByDuration();
  debug("sync", "ranked by duration, longest first", { created, updated, total: files.length });
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
      ...notManual,
    },
    orderBy: longestFirst,
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
      const probed = await writeThumb(video.id, filePath).catch(async () => {
        return probeDuration(filePath).catch(() => 0);
      });
      const duration = resolveDuration(probed, video.durationSeconds);
      const length = classifyDuration(duration);
      if (length === "unknown") {
        await markLengthUnread(video, filePath);
        continue;
      }
      if (length === "skip") {
        const message = `Skipped. ${duration.toFixed(1)}s is under 10 seconds, so it is not uploaded.`;
        await prisma.video.update({
          where: { id: video.id },
          data: {
            status: "excluded",
            isCanonical: false,
            scheduledAt: null,
            localPath: filePath,
            error: message,
            ...savedLength(duration, video.size),
          },
        });
        await logUpload(video.id, "skip", message);
        debug("process", "skipped, under 10 seconds", { video: video.name, seconds: Number(duration.toFixed(1)) });
        continue;
      }
      const fingerprint = await generateVideoFingerprint(filePath, duration);
      await prisma.video.update({
        where: { id: video.id },
        data: {
          fingerprint,
          status: "discovered",
          localPath: filePath,
          ...savedLength(duration, video.size),
        },
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
      ...notManual,
    },
    orderBy: longestFirst,
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
    debug("process", "processing", { video: video.name, stage: "openai", status: video.status, inQueue: true, scheduled: false });
    try {
      if (!settings.openaiApiKey) {
        throw new Error("OpenAI API key is not configured.");
      }
      await prisma.video.update({
        where: { id: video.id },
        data: { status: "analyzing", error: null },
      });
      const fresh = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
      const filePath = await ensureLocalFile(fresh);
      const probed = await probeDuration(filePath).catch(() => 0);
      const duration = resolveDuration(probed, fresh.durationSeconds);
      const length = classifyDuration(duration);
      if (length === "unknown") {
        await markLengthUnread(video, filePath);
        continue;
      }
      if (length === "skip") {
        const message = `Skipped. ${duration.toFixed(1)}s is under 10 seconds, so it is not uploaded.`;
        await prisma.video.update({
          where: { id: video.id },
          data: {
            status: "excluded",
            isCanonical: false,
            scheduledAt: null,
            error: message,
            ...savedLength(duration, fresh.size),
          },
        });
        await logUpload(video.id, "skip", message);
        debug("process", "skipped before title, under 10 seconds", { video: video.name, seconds: Number(duration.toFixed(1)) });
        continue;
      }
      const seo = await analyzeVideoWithOpenAI(filePath, {
        apiKey: settings.openaiApiKey,
        model: settings.openaiModel,
        prompt: settings.openaiPrompt,
      });
      const shaped = shapeForYouTube({
        title: seo.title,
        description: seo.description,
        tags: seo.tags,
        playlist: seo.playlist,
        format: length,
      });
      await prisma.video.update({
        where: { id: video.id },
        data: {
          status: "ready",
          title: shaped.title,
          description: shaped.description,
          tags: JSON.stringify(shaped.tags),
          category: seo.category,
          playlist: shaped.playlist,
          shortSummary: seo.shortSummary,
          localPath: filePath,
          error: null,
          ...savedLength(duration, fresh.size),
        },
      });
      await logUpload(video.id, "analyze", `${length === "short" ? "YouTube Short" : "Normal video"}: ${shaped.title}`);
      analyzed += 1;
      debug("process", length === "short" ? "ready as short" : "ready as normal video", {
        video: video.name,
        status: "ready",
        inQueue: true,
        scheduled: false,
        seconds: Number(duration.toFixed(1)),
        title: shaped.title,
      });
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

  await rankDriveVideosByDuration();
  const scheduled = await assignSlots();
  const remaining = await prisma.video.count({
    where: {
      isCanonical: true,
      status: { in: ["discovered", "failed", "hashing", "analyzing"] },
      ...notManual,
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
    where: { status: "uploading", updatedAt: { lt: staleBefore }, driveFileId: { startsWith: MANUAL_DRIVE_PREFIX } },
    data: {
      status: "failed",
      error: "The upload timed out before YouTube accepted the video.",
    },
  });
  await prisma.video.updateMany({
    where: { status: "uploading", updatedAt: { lt: staleBefore }, ...notManual },
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
      ...notManual,
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
      const probed = await probeDuration(filePath).catch(() => 0);
      const duration = resolveDuration(probed, fresh.durationSeconds);
      const length = classifyDuration(duration);
      if (length === "unknown") {
        await markLengthUnread(fresh, filePath);
        usedToday -= 1;
        skipped += 1;
        continue;
      }
      if (length === "skip") {
        const message = `Skipped. ${duration.toFixed(1)}s is under 10 seconds, so it is not uploaded.`;
        await prisma.video.update({
          where: { id: fresh.id },
          data: {
            status: "excluded",
            isCanonical: false,
            scheduledAt: null,
            error: message,
            ...savedLength(duration, fresh.size),
          },
        });
        await logUpload(fresh.id, "skip", message);
        usedToday -= 1;
        skipped += 1;
        debug("upload", "skipped, under 10 seconds", { video: fresh.name, seconds: Number(duration.toFixed(1)) });
        continue;
      }
      const privacy = asPrivacy(fresh.privacyStatus, settings.privacyDefault);
      const shaped = shapeForYouTube({
        title: fresh.title || fresh.name,
        description: fresh.description || "",
        tags: parseTags(fresh.tags),
        playlist: fresh.playlist,
        format: length,
      });
      const uploadPath = await fileForYouTube(filePath, length, fresh.name);
      const result = await uploadToYouTube({
        videoPath: uploadPath,
        title: shaped.title,
        description: shaped.description,
        tags: shaped.tags,
        categoryId: settings.categoryId,
        privacy,
        scheduledAt: fresh.scheduledAt,
        madeForKids: settings.madeForKids,
        playlist: shaped.playlist,
      });
      await prisma.video.update({
        where: { id: fresh.id },
        data: {
          status: "uploaded",
          title: shaped.title,
          description: shaped.description,
          tags: JSON.stringify(shaped.tags),
          playlist: shaped.playlist,
          youtubeVideoId: result.id,
          uploadedAt: new Date(),
          localPath: filePath,
          error: result.playlistWarning ? result.playlistWarning.slice(0, 1000) : null,
        },
      });
      await logUpload(
        fresh.id,
        "upload",
        `${length === "short" ? "YouTube Short" : "Normal video"}. YouTube id ${result.id}.${result.playlistWarning ? ` Playlist was not updated: ${result.playlistWarning}` : ""}`,
      );
      uploaded += 1;
      debug("upload", length === "short" ? "uploaded as short" : "uploaded as normal video", {
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

/** Download, title, and publish the next queued video immediately. */
export async function uploadNextVideo() {
  const settings = await getResolvedSettings();
  let skippedShort = 0;

  while (skippedShort <= 25) {
    const next = await prisma.video.findFirst({
      where: {
        isCanonical: true,
        status: { notIn: ["uploaded", "uploading", "duplicate", "excluded"] },
        ...notManual,
      },
      orderBy: longestFirst,
    });
    if (!next) {
      debug("upload-now", "no video waiting", { skippedShort });
      if (skippedShort > 0) {
        throw new Error(`Skipped ${skippedShort} videos under 10 seconds. No longer video is waiting.`);
      }
      throw new Error("No video is waiting. Sync the Drive folder, then try again.");
    }

    debug("upload-now", "picked next video", { video: next.name, status: next.status, sortOrder: next.sortOrder });
    const claimed = await prisma.video.updateMany({
      where: { id: next.id, status: next.status },
      data: { status: "uploading", error: null },
    });
    if (claimed.count === 0) {
      throw new Error("That video was already taken by another upload.");
    }

    try {
      let current = await prisma.video.findUniqueOrThrow({ where: { id: next.id } });
      const filePath = await ensureLocalFile(current);
      debug("upload-now", "file ready", { video: current.name, path: filePath });

      const probed = await writeThumb(current.id, filePath).catch(async () => probeDuration(filePath).catch(() => 0));
      const duration = resolveDuration(probed, current.durationSeconds);
      const length = classifyDuration(duration);
      if (length === "unknown") {
        await markLengthUnread(current, filePath);
        continue;
      }
      if (length === "skip") {
        const message = `Skipped. ${duration.toFixed(1)}s is under 10 seconds, so it is not uploaded.`;
        await prisma.video.update({
          where: { id: current.id },
          data: {
            status: "excluded",
            isCanonical: false,
            scheduledAt: null,
            localPath: filePath,
            error: message,
            ...savedLength(duration, current.size),
          },
        });
        await logUpload(current.id, "skip", message);
        skippedShort += 1;
        debug("upload-now", "skipped, under 10 seconds", { video: current.name, seconds: Number(duration.toFixed(1)) });
        continue;
      }

      if (!current.fingerprint) {
        const fingerprint = await generateVideoFingerprint(filePath, duration);
        await prisma.video.update({
          where: { id: current.id },
          data: { fingerprint, localPath: filePath, status: "uploading" },
        });
        await clusterVideos();
        current = await prisma.video.findUniqueOrThrow({ where: { id: next.id } });
        if (!current.isCanonical || current.status === "duplicate") {
          await prisma.video.update({
            where: { id: current.id },
            data: {
              status: "duplicate",
              isCanonical: false,
              error: "This copy matches another video, so it was not uploaded.",
            },
          });
          throw new Error(`${current.name} matches another video, so it was not uploaded.`);
        }
      }

      if (!settings.openaiApiKey) throw new Error("OpenAI API key is not configured.");
      debug("upload-now", length === "short" ? "writing a Short" : "writing a normal video", {
        video: current.name,
        model: settings.openaiModel,
        seconds: Number(duration.toFixed(1)),
      });
      const seo = await analyzeVideoWithOpenAI(filePath, {
        apiKey: settings.openaiApiKey,
        model: settings.openaiModel,
        prompt: settings.openaiPrompt,
      });
      const shaped = shapeForYouTube({
        title: seo.title,
        description: seo.description,
        tags: seo.tags,
        playlist: seo.playlist,
        format: length,
      });
      current = await prisma.video.update({
        where: { id: current.id },
        data: {
          status: "uploading",
          title: shaped.title,
          description: shaped.description,
          tags: JSON.stringify(shaped.tags),
          category: seo.category,
          playlist: shaped.playlist,
          shortSummary: seo.shortSummary,
          privacyStatus: "public",
          scheduledAt: null,
          localPath: filePath,
          error: null,
        },
      });

      debug("upload-now", length === "short" ? "publishing as a YouTube Short" : "publishing as a normal video", {
        video: current.name,
        title: current.title,
        playlist: shaped.playlist,
        privacy: "public",
      });
      const uploadPath = await fileForYouTube(filePath, length, current.name);
      const result = await uploadToYouTube({
        videoPath: uploadPath,
        title: shaped.title,
        description: shaped.description,
        tags: shaped.tags,
        categoryId: settings.categoryId,
        privacy: "public",
        scheduledAt: null,
        madeForKids: settings.madeForKids,
        playlist: shaped.playlist,
      });
      await prisma.video.update({
        where: { id: current.id },
        data: {
          status: "uploaded",
          privacyStatus: "public",
          scheduledAt: null,
          youtubeVideoId: result.id,
          uploadedAt: new Date(),
          localPath: filePath,
          error: result.playlistWarning ? result.playlistWarning.slice(0, 1000) : null,
        },
      });
      const destination = length === "short" ? "YouTube Short" : "normal video";
      await logUpload(
        current.id,
        "upload",
        result.playlistWarning
          ? `Upload now. ${destination}. YouTube id ${result.id}. Playlist was not updated: ${result.playlistWarning}`
          : `Upload now. ${destination}. YouTube id ${result.id}`,
      );
      debug("upload-now", "uploaded", { video: current.name, youtubeId: result.id, title: current.title, destination });
      const title = current.title || current.name;
      const skippedNote = skippedShort > 0 ? ` Skipped ${skippedShort} clip${skippedShort === 1 ? "" : "s"} under 10 seconds.` : "";
      return {
        name: current.name,
        title,
        youtubeVideoId: result.id,
        playlistWarning: result.playlistWarning || null,
        message: result.playlistWarning
          ? `Uploaded ${title} as a ${destination}. Playlist was not updated.${skippedNote}`
          : `Uploaded ${title} as a ${destination}.${skippedNote}`,
      };
    } catch (error) {
      const message = errorMessage(error);
      const latest = await prisma.video.findUnique({ where: { id: next.id } });
      if (latest && latest.status !== "duplicate" && latest.status !== "uploaded" && latest.status !== "excluded") {
        await prisma.video.update({
          where: { id: next.id },
          data: { status: "failed", error: message.slice(0, 1000) },
        });
        await logUpload(next.id, "error", message);
      }
      debugError("upload-now", "failed", { video: next.name, error: message });
      throw error;
    }
  }

  throw new Error(`Skipped ${skippedShort} videos under 10 seconds. Click Upload now again for the next longer video.`);
}

/** Publish a file from this computer immediately. It never enters the schedule. */
export async function publishManualVideo(input: { filePath: string; name: string; mimeType: string; size: number }) {
  const settings = await getResolvedSettings();
  if (!settings.openaiApiKey) throw new Error("OpenAI API key is not configured.");

  const duration = await probeDuration(input.filePath);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not read this video's length, so it was not uploaded.");
  }
  const length = classifyDuration(duration);
  debug("direct", "measured length", { video: input.name, seconds: Number(duration.toFixed(1)), length });
  if (length === "skip") {
    fs.rmSync(input.filePath, { force: true });
    throw new Error(`This video is ${duration.toFixed(1)} seconds. Videos under 10 seconds are not uploaded.`);
  }
  if (length !== "short" && length !== "standard") {
    throw new Error("Could not read this video's length, so it was not uploaded.");
  }

  const name = path.basename(input.name).slice(0, 180) || "video.mp4";
  const maxOrder = await prisma.video.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.video.create({
    data: {
      driveFileId: `${MANUAL_DRIVE_PREFIX}${randomUUID()}`,
      name,
      mimeType: input.mimeType || "video/mp4",
      size: String(input.size),
      localPath: input.filePath,
      status: "uploading",
      isCanonical: true,
      privacyStatus: "public",
      scheduledAt: null,
      ...savedLength(duration, String(input.size)),
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
  });

  try {
    await writeThumb(created.id, input.filePath).catch(() => undefined);
    debug("direct", length === "short" ? "writing a Short" : "writing a normal video", {
      video: name,
      model: settings.openaiModel,
      seconds: Number(duration.toFixed(1)),
    });
    const seo = await analyzeVideoWithOpenAI(input.filePath, {
      apiKey: settings.openaiApiKey,
      model: settings.openaiModel,
      prompt: settings.openaiPrompt,
    });
    const shaped = shapeForYouTube({
      title: seo.title,
      description: seo.description,
      tags: seo.tags,
      playlist: seo.playlist,
      format: length,
    });
    await prisma.video.update({
      where: { id: created.id },
      data: {
        title: shaped.title,
        description: shaped.description,
        tags: JSON.stringify(shaped.tags),
        category: seo.category,
        playlist: shaped.playlist,
        shortSummary: seo.shortSummary,
      },
    });
    debug("direct", length === "short" ? "publishing as a YouTube Short" : "publishing as a normal video", {
      video: name,
      title: shaped.title,
      playlist: shaped.playlist,
    });
    const uploadPath = await fileForYouTube(input.filePath, length, name);
    const result = await uploadToYouTube({
      videoPath: uploadPath,
      title: shaped.title,
      description: shaped.description,
      tags: shaped.tags,
      categoryId: settings.categoryId,
      privacy: "public",
      scheduledAt: null,
      madeForKids: settings.madeForKids,
      playlist: shaped.playlist,
    });
    await prisma.video.update({
      where: { id: created.id },
      data: {
        status: "uploaded",
        privacyStatus: "public",
        scheduledAt: null,
        youtubeVideoId: result.id,
        uploadedAt: new Date(),
        error: result.playlistWarning ? result.playlistWarning.slice(0, 1000) : null,
      },
    });
    const destination = length === "short" ? "YouTube Short" : "normal video";
    await logUpload(
      created.id,
      "upload",
      result.playlistWarning
        ? `Direct upload. ${destination}. YouTube id ${result.id}. Playlist was not updated: ${result.playlistWarning}`
        : `Direct upload. ${destination}. YouTube id ${result.id}`,
    );
    debug("direct", "uploaded", { video: name, youtubeId: result.id, title: shaped.title, destination });
    return {
      name,
      title: shaped.title,
      youtubeVideoId: result.id,
      destination,
      playlistWarning: result.playlistWarning || null,
      message: result.playlistWarning
        ? `Uploaded ${shaped.title} as a ${destination}. Playlist was not updated.`
        : `Uploaded ${shaped.title} as a ${destination}.`,
    };
  } catch (error) {
    const message = errorMessage(error);
    await prisma.video.update({
      where: { id: created.id },
      data: { status: "failed", error: message.slice(0, 1000) },
    });
    await logUpload(created.id, "error", message);
    debugError("direct", "failed", { video: name, error: message });
    throw error;
  }
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
