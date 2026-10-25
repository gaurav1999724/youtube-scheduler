import { spawn } from "child_process";
import { z } from "zod";
import { ffmpegPath } from "@/lib/ffmpeg-bin";
import { probeDuration } from "@/lib/media";

const seoSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).max(30).default([]),
  category: z.string().optional(),
  playlist: z.string().optional(),
  shortSummary: z.string().optional(),
});

export type SeoMetadata = {
  title: string;
  description: string;
  tags: string[];
  category: string;
  playlist: string;
  shortSummary: string;
};

function parseModelJson(raw: string): SeoMetadata {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("OpenAI did not return JSON.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error("OpenAI returned JSON that could not be parsed.");
  }
  const result = seoSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message || "OpenAI JSON did not match the SEO schema.");
  }
  const tags = result.data.tags.map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean).slice(0, 15);
  return {
    title: result.data.title.replace(/\s+/g, " ").trim().slice(0, 100),
    description: result.data.description.trim().slice(0, 5000),
    tags,
    category: result.data.category?.trim() || "Film & Animation",
    playlist: result.data.playlist?.trim() || "Cartoon Shorts / Kids AI Series",
    shortSummary: result.data.shortSummary?.trim() || "",
  };
}

function frameJpeg(videoPath: string, seconds: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpegPath(),
      [
        "-ss",
        Math.max(0, seconds).toFixed(3),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=640:-1",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      const image = Buffer.concat(chunks);
      if (code !== 0 || image.length < 100) {
        reject(new Error(stderr.trim().slice(-300) || "Could not read a frame from the video."));
        return;
      }
      resolve(image);
    });
  });
}

async function sampleFrames(videoPath: string): Promise<string[]> {
  const duration = await probeDuration(videoPath).catch(() => 0);
  const marks = duration > 1 ? [0.1, 0.35, 0.6, 0.85].map((ratio) => Math.min(duration * ratio, Math.max(0, duration - 0.1))) : [0];
  const frames: string[] = [];
  for (const seconds of marks) {
    try {
      const image = await frameJpeg(videoPath, seconds);
      frames.push(image.toString("base64"));
    } catch {
      // A later frame can still describe the clip.
    }
  }
  if (frames.length === 0) {
    throw new Error("OpenAI could not read any frames from this video.");
  }
  return frames;
}

function explainOpenAiError(status: number, body: string): Error {
  if (status === 401) {
    return new Error("OpenAI rejected the API key. Paste a key that starts with sk- under Settings → OpenAI, then save.");
  }
  let message = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) message = parsed.error.message;
  } catch {
    // The raw body is enough.
  }
  return new Error(`OpenAI request failed (${status}). ${message}`);
}

export async function analyzeVideoWithOpenAI(
  localFilePath: string,
  options: { apiKey: string; model: string; prompt: string },
): Promise<SeoMetadata> {
  const frames = await sampleFrames(localFilePath);
  const prompt = `${options.prompt.trim()}

These images are frames from one video, in time order. You cannot hear the audio. Infer the story from what is visible.
Return only one JSON object with the keys title, description, tags, category, playlist, and shortSummary.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || "gpt-4o",
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...frames.map((frame) => ({
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${frame}` },
            })),
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw explainOpenAiError(response.status, await response.text());
  }
  const payload = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned an empty response.");
  return parseModelJson(text);
}
