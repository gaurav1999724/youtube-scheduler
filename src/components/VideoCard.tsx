"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Play, RotateCcw, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { formatBytes, STATUS_LABEL, type PrivacyStatus, type VideoDTO } from "@/lib/types";

function badgeVariant(status: string) {
  if (status === "uploaded") return "success" as const;
  if (status === "failed" || status === "duplicate") return "danger" as const;
  if (status === "scheduled" || status === "ready") return "info" as const;
  return "default" as const;
}

export function VideoCard({ video, onChanged }: { video: VideoDTO; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(video.title || "");
  const [description, setDescription] = useState(video.description || "");
  const [tags, setTags] = useState(video.tags.join(", "));
  const [playlist, setPlaylist] = useState(video.playlist || "");
  const [privacy, setPrivacy] = useState<PrivacyStatus>(
    video.privacyStatus === "public" || video.privacyStatus === "unlisted" ? video.privacyStatus : "private",
  );

  async function run(body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      await api(`/api/videos/${video.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(success);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative aspect-video bg-black">
        {video.hasThumb ? (
          // Thumbnails are served by our own file route, so the image optimizer is not used.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/videos/${video.id}/thumb`}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No preview yet
          </div>
        )}
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <Badge variant={badgeVariant(video.status)}>{STATUS_LABEL[video.status] || video.status}</Badge>
          {!video.isCanonical && <Badge variant="danger">Duplicate</Badge>}
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <h3 className="line-clamp-2 text-base font-semibold">{video.title || video.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {video.name} · {formatBytes(video.size)}
          </p>
        </div>
        {video.shortSummary && <p className="line-clamp-2 text-sm text-muted-foreground">{video.shortSummary}</p>}
        {video.error && <p className="text-xs text-red-300">{video.error}</p>}
        {video.duplicateOf && (
          <p className="text-xs text-muted-foreground">Same picture as {video.duplicateOf.title || video.duplicateOf.name}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={!video.hasFile}>
            <Play className="h-4 w-4" />
            Preview
          </Button>
          {video.status === "duplicate" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run({ promote: true }, "Queued this copy")}>
              <Star className="h-4 w-4" />
              Keep this one
            </Button>
          )}
          {video.status === "failed" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run({ retry: true }, "Returned to the queue")}>
              <RotateCcw className="h-4 w-4" />
              Retry
            </Button>
          )}
          {video.isCanonical && video.status !== "uploaded" && video.status !== "uploading" && video.status !== "excluded" && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run({ exclude: true }, "Removed from the queue")}>
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          )}
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{video.title || video.name}</DialogTitle>
            <DialogDescription>Preview the file and adjust the metadata before it publishes.</DialogDescription>
          </DialogHeader>
          {video.hasFile && (
            <video
              key={video.id}
              controls
              className="max-h-[360px] w-full rounded-lg bg-black"
              poster={video.hasThumb ? `/api/videos/${video.id}/thumb` : undefined}
              src={`/api/videos/${video.id}/stream`}
            />
          )}
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor={`title-${video.id}`}>Title</Label>
              <Input id={`title-${video.id}`} value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`description-${video.id}`}>Description</Label>
              <Textarea id={`description-${video.id}`} value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`tags-${video.id}`}>Tags</Label>
              <Input id={`tags-${video.id}`} value={tags} onChange={(event) => setTags(event.target.value)} placeholder="comma separated" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`playlist-${video.id}`}>Playlist</Label>
                <Input id={`playlist-${video.id}`} value={playlist} onChange={(event) => setPlaylist(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Privacy</Label>
                <Select value={privacy} onValueChange={(value) => setPrivacy(value as PrivacyStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="unlisted">Unlisted</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              disabled={busy}
              onClick={() =>
                run(
                  {
                    title,
                    description,
                    tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
                    playlist,
                    privacyStatus: privacy,
                  },
                  "Metadata saved",
                )
              }
            >
              Save metadata
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}
