import { FileState, GoogleGenAI } from "@google/genai";
import { z } from "zod";

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
    throw new Error("Gemini did not return JSON.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error("Gemini returned JSON that could not be parsed.");
  }
  const result = seoSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message || "Gemini JSON did not match the SEO schema.");
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function explainGeminiError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("Your project has been denied access") || raw.includes("PERMISSION_DENIED")) {
    return new Error(
      "Gemini blocked this API key. Google denied the Cloud project that owns it, so the title was not written and the video was not uploaded. Create a new key at https://aistudio.google.com/apikey in a project with billing turned on, paste it under Settings → Gemini, save, and run Upload now again.",
    );
  }
  return error instanceof Error ? error : new Error(raw || "Gemini request failed.");
}

export async function analyzeVideoWithGemini(
  localFilePath: string,
  options: { mimeType?: string; apiKey: string; model: string; prompt: string },
): Promise<SeoMetadata> {
  const mimeType = options.mimeType || "video/mp4";
  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  let fileName = "";
  try {
    const uploaded = await ai.files.upload({
      file: localFilePath,
      config: {
        mimeType,
        displayName: "Cartoon Video Analysis",
      },
    });
    if (!uploaded.name) throw new Error("Gemini did not return a file name.");
    fileName = uploaded.name;

    let file = uploaded;
    const deadline = Date.now() + 3 * 60 * 1000;
    while (file.state && file.state !== FileState.ACTIVE) {
      if (file.state === FileState.FAILED) {
        throw new Error(file.error?.message || "Gemini video processing failed.");
      }
      if (Date.now() > deadline) {
        throw new Error("Gemini was still processing the video after 3 minutes.");
      }
      await sleep(3000);
      file = await ai.files.get({ name: file.name! });
    }
    if (!file.uri || !file.mimeType) {
      throw new Error("Gemini did not return a playable file URI.");
    }

    const prompt = `${options.prompt.trim()}

Return only one JSON object with the keys title, description, tags, category, playlist, and shortSummary.`;
    const response = await ai.models.generateContent({
      model: options.model,
      contents: [
        { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
        prompt,
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.4,
      },
    });
    const text = response.text;
    if (!text) throw new Error("Gemini returned an empty response.");
    return parseModelJson(text);
  } catch (error) {
    throw explainGeminiError(error);
  } finally {
    if (fileName) {
      await ai.files.delete({ name: fileName }).catch(() => undefined);
    }
  }
}
