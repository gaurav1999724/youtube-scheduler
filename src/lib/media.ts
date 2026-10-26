import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { configureFfmpeg, ffmpegPath } from "@/lib/ffmpeg-bin";

configureFfmpeg();

function finish(command: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    command.on("end", () => resolve()).on("error", (error: Error) => reject(error)).run();
  });
}

export function probeDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), ["-hide_banner", "-i", videoPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (seconds: number) => {
      if (settled) return;
      settled = true;
      resolve(seconds);
      proc.kill("SIGKILL");
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
      const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      if (!match) return;
      finish(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
    });
    proc.on("error", fail);
    proc.on("close", () => {
      if (!settled) fail(new Error("Could not read the video duration."));
    });
  });
}

export function needsVerticalShort(width: number, height: number) {
  return !(width > 0 && height > width);
}

export function probeFrameSize(videoPath: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), ["-hide_banner", "-i", videoPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (frame: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      resolve(frame);
      proc.kill("SIGKILL");
    };
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 40000) stderr = stderr.slice(-40000);
      const match = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(stderr);
      if (!match) return;
      finish({ width: Number(match[1]), height: Number(match[2]) });
    });
    proc.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    proc.on("close", () => finish(null));
  });
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split("\n").slice(-2).join(" ") || `ffmpeg exited ${code}`));
    });
  });
}

const SHORT_FILTER = [
  "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,scale=270:480,scale=1080:1920:flags=fast_bilinear[bg]",
  "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg]",
  "[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]",
].join(";");

async function renderVerticalShort(input: string, output: string) {
  const base = ["-y", "-i", input, "-filter_complex", SHORT_FILTER, "-map", "[v]"];
  const video = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart"];
  try {
    await runFfmpeg([...base, "-map", "0:a?", "-c:a", "aac", "-b:a", "128k", ...video, output]);
  } catch {
    if (fs.existsSync(output)) fs.unlinkSync(output);
    await runFfmpeg([...base, ...video, "-an", output]);
  }
}

/** YouTube files a Short from a vertical picture. Landscape clips are fitted into a 1080x1920 frame. */
export async function ensureVerticalShort(input: string): Promise<string> {
  const frame = await probeFrameSize(input).catch(() => null);
  if (frame && !needsVerticalShort(frame.width, frame.height)) return input;
  const parsed = path.parse(input);
  const output = path.join(parsed.dir, `${parsed.name}-short.mp4`);
  if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= fs.statSync(input).mtimeMs) {
    const rendered = await probeFrameSize(output).catch(() => null);
    if (rendered && rendered.height > rendered.width) return output;
  }
  await renderVerticalShort(input, output);
  return output;
}

export function writeThumbnail(videoPath: string, dest: string, atSeconds: number): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  return finish(
    ffmpeg(videoPath)
      .seekInput(Math.max(0, atSeconds))
      .outputOptions(["-frames:v", "1", "-vf", "scale=640:-1"])
      .output(dest),
  );
}

export async function transcodeToMp4(input: string, output: string): Promise<void> {
  const attempt = (withAudio: boolean) => {
    let command = ffmpeg(input)
      .videoCodec("libx264")
      .outputOptions(["-movflags", "+faststart", "-pix_fmt", "yuv420p", "-preset", "veryfast"]);
    command = withAudio ? command.audioCodec("aac") : command.noAudio();
    return finish(command.output(output));
  };
  try {
    await attempt(true);
  } catch {
    if (fs.existsSync(output)) fs.unlinkSync(output);
    await attempt(false);
  }
}
