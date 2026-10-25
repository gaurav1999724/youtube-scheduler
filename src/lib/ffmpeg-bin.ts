import { spawnSync } from "child_process";
import path from "path";
import ffmpeg from "fluent-ffmpeg";

const bundledFfmpeg = path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");

function runnable(bin: string | null | undefined) {
  if (!bin) return "";
  const check = spawnSync(bin, ["-version"], { stdio: "ignore" });
  return check.status === 0 ? bin : "";
}

let cachedFfmpeg = "";

export function ffmpegPath() {
  if (cachedFfmpeg) return cachedFfmpeg;
  const fromEnv = runnable(process.env.FFMPEG_PATH);
  if (fromEnv) return (cachedFfmpeg = fromEnv);
  if (runnable("ffmpeg")) return (cachedFfmpeg = "ffmpeg");
  const bundled = runnable(bundledFfmpeg);
  return (cachedFfmpeg = bundled || "ffmpeg");
}

export function ffprobePath() {
  const fromEnv = runnable(process.env.FFPROBE_PATH);
  if (fromEnv) return fromEnv;
  if (runnable("ffprobe")) return "ffprobe";
  return "";
}

let configured = false;

export function configureFfmpeg() {
  if (configured) return;
  configured = true;
  const bin = ffmpegPath();
  const probe = ffprobePath();
  if (bin !== "ffmpeg") ffmpeg.setFfmpegPath(bin);
  if (probe) ffmpeg.setFfprobePath(probe);
}
