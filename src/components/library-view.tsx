"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { VideoCard } from "@/components/VideoCard";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { VideoDTO } from "@/lib/types";

const filters = ["All", "Unique", "Duplicates", "Failed"] as const;

export function LibraryView() {
  const [videos, setVideos] = useState<VideoDTO[]>([]);
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  async function load() {
    const data = await api<{ videos: VideoDTO[] }>("/api/videos");
    setVideos(data.videos);
  }

  useEffect(() => {
    load()
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    if (filter === "Unique") return videos.filter((video) => video.isCanonical && video.status !== "duplicate");
    if (filter === "Duplicates") return videos.filter((video) => video.status === "duplicate" || !video.isCanonical);
    if (filter === "Failed") return videos.filter((video) => video.status === "failed");
    return videos;
  }, [filter, videos]);

  async function run(path: string, label: string) {
    setBusy(label);
    try {
      const result = await api<Record<string, unknown>>(path, { method: "POST" });
      if (path.endsWith("sync")) {
        toast.success(`Drive sync found ${String(result.total ?? 0)} videos.`);
      } else {
        const errors = Array.isArray(result.errors) ? result.errors.length : 0;
        toast.success(errors ? `Processed with ${errors} errors.` : "Library processed.");
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Library</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Video library</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Sync the Drive folder, then process the library. Matching pictures are badged as duplicates and kept out of the upload queue.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={Boolean(busy)} onClick={() => run("/api/drive/sync", "Syncing")}>
            {busy === "Syncing" ? "Syncing…" : "Sync Drive"}
          </Button>
          <Button disabled={Boolean(busy)} onClick={() => run("/api/videos/process", "Processing")}>
            {busy === "Processing" ? "Processing…" : "Process library"}
          </Button>
        </div>
      </div>
      <div className="flex gap-2">
        {filters.map((item) => (
          <Button key={item} size="sm" variant={filter === item ? "default" : "outline"} onClick={() => setFilter(item)}>
            {item}
          </Button>
        ))}
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading videos…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-sm text-muted-foreground">
          No videos in this view. Save your Drive credentials, sync the folder, then process the library. Processing downloads each file, so large folders can take a while.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((video) => (
            <VideoCard key={video.id} video={video} onChanged={() => load().catch(() => undefined)} />
          ))}
        </div>
      )}
    </div>
  );
}
