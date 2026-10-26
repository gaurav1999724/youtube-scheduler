"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api-client";

const CHUNK_BYTES = 3 * 1024 * 1024;
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"];

type UploadResult = {
  title: string;
  youtubeVideoId: string;
  destination: string;
  message: string;
};

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function UploadView() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "sending" | "publishing">("idle");
  const [sent, setSent] = useState(0);
  const [result, setResult] = useState<UploadResult | null>(null);

  const busy = phase !== "idle";

  function choose(next: File | null) {
    setResult(null);
    if (!next) {
      setFile(null);
      return;
    }
    const ext = next.name.slice(next.name.lastIndexOf(".")).toLowerCase();
    if (!VIDEO_EXTENSIONS.includes(ext)) {
      toast.error("Use an mp4, mov, mkv, webm, m4v, or avi file.");
      return;
    }
    if (next.size <= 0) {
      toast.error("That video file is empty.");
      return;
    }
    if (next.size > 2 * 1024 * 1024 * 1024) {
      toast.error("This video is larger than 2 GB.");
      return;
    }
    setFile(next);
  }

  async function publish() {
    if (!file || busy) return;
    setResult(null);
    setSent(0);
    setPhase("sending");
    const uploadId = crypto.randomUUID();
    const total = Math.ceil(file.size / CHUNK_BYTES);
    try {
      for (let index = 0; index < total; index += 1) {
        const start = index * CHUNK_BYTES;
        const chunk = file.slice(start, Math.min(file.size, start + CHUNK_BYTES));
        const body = new FormData();
        body.set("uploadId", uploadId);
        body.set("index", String(index));
        body.set("chunk", chunk, file.name);
        const response = await fetch("/api/videos/direct", { method: "POST", body });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 401) {
          window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        }
        if (!response.ok) throw new Error(data.error || "The video could not be sent.");
        setSent(Math.min(file.size, start + chunk.size));
      }
      setPhase("publishing");
      const published = await api<UploadResult>("/api/videos/direct", {
        method: "POST",
        body: JSON.stringify({
          uploadId,
          total,
          name: file.name,
          mimeType: file.type || "video/mp4",
        }),
      });
      setResult(published);
      toast.success(published.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setPhase("idle");
    }
  }

  const progress = file && file.size > 0 ? Math.round((sent / file.size) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Upload</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Upload a video</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Choose a video from this computer. OpenAI writes the title, description, and tags, then the video is published on YouTube immediately. This does not use the schedule. Videos under 10 seconds are skipped. Videos from 10 seconds through 2 minutes go out as Shorts. Longer videos go out as normal videos.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Video file</CardTitle>
          <CardDescription>mp4, mov, mkv, webm, m4v, or avi. Up to 2 GB.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="grid cursor-pointer gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center hover:bg-accent/40">
            <span className="text-sm font-medium">{file ? file.name : "Choose a video"}</span>
            <span className="text-xs text-muted-foreground">{file ? formatBytes(file.size) : "Click to browse"}</span>
            <input
              className="sr-only"
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.mkv,.webm,.m4v,.avi"
              disabled={busy}
              onChange={(event) => choose(event.target.files?.[0] ?? null)}
            />
          </label>
          {phase === "sending" ? (
            <div className="grid gap-2">
              <div className="h-2 overflow-hidden rounded-full bg-accent">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">Sending the file… {progress}%</p>
            </div>
          ) : null}
          {phase === "publishing" ? (
            <p className="text-sm text-muted-foreground">Writing the title, description, and tags, then publishing on YouTube…</p>
          ) : null}
          <Button onClick={publish} disabled={!file || busy}>
            {busy ? "Uploading…" : "Upload to YouTube"}
          </Button>
          {result ? (
            <p className="text-sm">
              {result.message}{" "}
              <a
                className="font-medium text-primary underline-offset-4 hover:underline"
                href={`https://www.youtube.com/watch?v=${result.youtubeVideoId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open on YouTube
              </a>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
