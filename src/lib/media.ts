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
    const proc = spawn(ffmpegPath(), ["-i", videoPath, "-f", "null", "-"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    proc.on("error", reject);
    proc.on("close", () => {
      const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      if (!match) {
        reject(new Error("Could not read the video duration."));
        return;
      }
      resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
    });
  });
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
