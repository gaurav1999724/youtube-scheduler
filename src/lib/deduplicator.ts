import { spawn } from "child_process";

export const DUPLICATE_HAMMING_THRESHOLD = 18;

function runFfmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim().slice(-400) || `ffmpeg exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

export async function extractGrayFrame(videoPath: string, seconds: number): Promise<Buffer> {
  const buffer = await runFfmpeg([
    "-ss",
    Math.max(0, seconds).toFixed(3),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=9:8,format=gray",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  if (buffer.length < 72) {
    throw new Error("Could not read a 9x8 sample frame from the video.");
  }
  return buffer.subarray(0, 72);
}

/** 64-bit difference hash from a 9x8 grayscale frame. */
export function dHashFromGray(frame: Buffer): bigint {
  let hash = 0n;
  let bit = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = frame[y * 9 + x];
      const right = frame[y * 9 + x + 1];
      if (left > right) hash |= 1n << bit;
      bit += 1n;
    }
  }
  return hash;
}

export function hashToHex(hash: bigint): string {
  return hash.toString(16).padStart(16, "0");
}

export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (value > 0n) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

export function isDuplicateFingerprint(
  a: string,
  b: string,
  threshold = DUPLICATE_HAMMING_THRESHOLD,
) {
  return hammingDistance(a, b) <= threshold;
}

export function samplePoints(duration: number): number[] {
  if (!Number.isFinite(duration) || duration < 1) return [0, 0.3, 0.6];
  const last = Math.max(0, duration - 0.1);
  return [duration * 0.1, duration * 0.5, duration * 0.9].map((point) =>
    Math.min(Math.max(0, point), last),
  );
}

/**
 * Three-frame perceptual fingerprint. Matching hashes (within a small
 * Hamming distance) are treated as the same picture even when filenames differ.
 */
export async function generateVideoFingerprint(videoPath: string, duration = 0): Promise<string> {
  const points = samplePoints(duration);
  const parts: string[] = [];
  for (const point of points) {
    let frame: Buffer;
    try {
      frame = await extractGrayFrame(videoPath, point);
    } catch {
      frame = await extractGrayFrame(videoPath, 0);
    }
    parts.push(hashToHex(dHashFromGray(frame)));
  }
  return parts.join("");
}

export type FingerprintItem = { id: string; fingerprint: string };

export function groupByFingerprint(
  items: FingerprintItem[],
  threshold = DUPLICATE_HAMMING_THRESHOLD,
): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (let i = 0; i < items.length; i += 1) {
    parent.set(items[i].id, items[i].id);
    for (let j = i + 1; j < items.length; j += 1) {
      if (isDuplicateFingerprint(items[i].fingerprint, items[j].fingerprint, threshold)) {
        union(items[i].id, items[j].id);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const item of items) {
    const root = find(item.id);
    const list = groups.get(root) ?? [];
    list.push(item.id);
    groups.set(root, list);
  }
  return [...groups.values()];
}
