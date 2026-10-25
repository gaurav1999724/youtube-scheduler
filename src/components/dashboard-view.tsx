"use client";

import { useEffect, useState } from "react";
import { Clapperboard, Copy, Film, ListOrdered, Upload } from "lucide-react";
import { ChannelStatusCard } from "@/components/ChannelStatusCard";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api-client";

type Stats = {
  total: number;
  duplicates: number;
  processed: number;
  queued: number;
  uploaded: number;
  channel: { connected: boolean; channelId: string; channelTitle: string };
  recent: { id: string; title: string | null; name: string; uploadedAt: string | null; youtubeVideoId: string | null }[];
  logs: { id: string; action: string; message: string; createdAt: string; videoName: string }[];
};

const metrics = [
  { key: "total", label: "Videos in Drive", icon: Film },
  { key: "duplicates", label: "Duplicates found", icon: Copy },
  { key: "processed", label: "Processed", icon: Clapperboard },
  { key: "queued", label: "Queued", icon: ListOrdered },
  { key: "uploaded", label: "Uploaded", icon: Upload },
] as const;

export function DashboardView() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Stats>("/api/stats")
      .then(setStats)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!stats) return <p className="text-sm text-muted-foreground">Loading the studio…</p>;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Overview</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">AutoTube AI Studio</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Drive videos are fingerprinted, duplicates stay out of the queue, and OpenAI writes the title before the daily slots go out.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.key}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between text-muted-foreground">
                  <p className="text-xs uppercase tracking-wide">{metric.label}</p>
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <p className="mt-3 text-3xl font-semibold">{stats[metric.key]}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChannelStatusCard {...stats.channel} />
        <Card>
          <CardContent className="space-y-3 p-6">
            <h2 className="text-lg font-semibold">Recent uploads</h2>
            {stats.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing has been published from this studio yet.</p>
            ) : (
              stats.recent.map((video) => (
                <div key={video.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{video.title || video.name}</span>
                  {video.youtubeVideoId && (
                    <a
                      className="shrink-0 text-primary hover:underline"
                      href={`https://www.youtube.com/watch?v=${video.youtubeVideoId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-lg font-semibold">Activity</h2>
          {stats.logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sync a Drive folder to start the log.</p>
          ) : (
            stats.logs.map((entry) => (
              <div key={entry.id} className="grid gap-1 border-b border-border pb-3 text-sm last:border-0">
                <p className="font-medium">{entry.videoName}</p>
                <p className="text-muted-foreground">
                  {entry.action} · {entry.message}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
