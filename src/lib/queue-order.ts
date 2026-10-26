/** Higher scores are picked first. Known videos of 10 seconds or longer stay ahead of files whose length is still unknown. */
export function queueScoreFor(durationSeconds: number | null, size: string | null): number {
  if (durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds >= 10) {
    return 1_000_000_000 + durationSeconds;
  }
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    const bytes = Number(size ?? 0);
    const megabytes = Number.isFinite(bytes) && bytes > 0 ? bytes / (1024 * 1024) : 0;
    return 100_000_000 + Math.min(megabytes, 800_000_000);
  }
  return durationSeconds;
}

export function resolveDuration(probed: number, stored: number | null | undefined): number {
  if (Number.isFinite(probed) && probed > 0) return probed;
  if (stored != null && Number.isFinite(stored) && stored > 0) return stored;
  return 0;
}

export function savedLength(seconds: number, size: string | null) {
  if (!Number.isFinite(seconds) || seconds <= 0) return { queueScore: -1 };
  return { durationSeconds: seconds, queueScore: queueScoreFor(seconds, size) };
}
