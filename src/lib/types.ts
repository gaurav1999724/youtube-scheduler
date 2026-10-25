export const DEFAULT_DRIVE_FOLDER_ID = "1sS5RLXEKdz4Cb3K9vPp_sxKO75Ds36CL";

export const DEFAULT_OPENAI_MODEL = "gpt-4o";

export const DEFAULT_OPENAI_PROMPT = `Analyze this cartoon animation video thoroughly. Use the frames to judge the visual scenes, character actions, and tone.
Return ONLY a valid JSON object with this schema and no markdown:
{
  "title": "High-CTR YouTube title under 70 characters with exactly one relevant emoji",
  "description": "Engaging 2-3 paragraph description summarizing the cartoon storyline, character antics, and moral. Then add timestamp chapters, a line of keywords, and a short disclaimer that this is an AI-assisted cartoon short.",
  "tags": ["up to 15 relevant SEO tags without a hash prefix"],
  "category": "Film & Animation",
  "playlist": "Cartoon Shorts / Kids AI Series",
  "shortSummary": "One sentence summary of the clip"
}`;

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

export type PrivacyStatus = "private" | "unlisted" | "public";
export type DriveAuthMode = "oauth" | "service_account";

export type VideoDTO = {
  id: string;
  driveFileId: string;
  name: string;
  mimeType: string;
  size: string | null;
  driveModifiedAt: string | null;
  hasFile: boolean;
  hasThumb: boolean;
  fingerprint: string | null;
  duplicateOfId: string | null;
  duplicateOf: { id: string; name: string; title: string | null } | null;
  duplicates: { id: string; name: string; title: string | null; status: string }[];
  isCanonical: boolean;
  status: string;
  title: string | null;
  description: string | null;
  tags: string[];
  category: string | null;
  playlist: string | null;
  shortSummary: string | null;
  sortOrder: number;
  durationSeconds: number | null;
  scheduledAt: string | null;
  privacyStatus: string | null;
  youtubeVideoId: string | null;
  uploadedAt: string | null;
  error: string | null;
  createdAt: string;
};

export type PublicSettings = {
  googleClientId: string;
  hasGoogleClientSecret: boolean;
  hasRefreshToken: boolean;
  hasServiceAccount: boolean;
  driveAuthMode: DriveAuthMode;
  driveFolderId: string;
  hasOpenAiKey: boolean;
  openaiModel: string;
  openaiPrompt: string;
  dailyUploadCount: number;
  uploadTimes: string;
  timezone: string;
  privacyDefault: PrivacyStatus;
  madeForKids: boolean;
  categoryId: string;
  channelId: string;
  channelTitle: string;
  connected: boolean;
};

export const STATUS_LABEL: Record<string, string> = {
  discovered: "Discovered",
  hashing: "Hashing",
  duplicate: "Duplicate",
  analyzing: "Analyzing",
  ready: "Ready",
  scheduled: "Scheduled",
  uploading: "Uploading",
  uploaded: "Uploaded",
  failed: "Failed",
  excluded: "Excluded",
};

export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "Length unknown";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remain.toString().padStart(2, "0")}s`;
  return `${remain}s`;
}

export function formatBytes(size: string | null): string {
  const value = Number(size ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  const digits = current >= 10 || index === 0 ? 0 : 1;
  return `${current.toFixed(digits)} ${units[index]}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unexpected error";
}
