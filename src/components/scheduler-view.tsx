"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DayPlanEditor, type DayDraft } from "@/components/DayPlanEditor";
import { ScheduleTimeline, type DayPlanView } from "@/components/ScheduleTimeline";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { VideoDTO } from "@/lib/types";

const QUEUE_STATUSES = new Set(["ready", "scheduled", "uploading", "failed"]);

export function SchedulerView() {
  const [videos, setVideos] = useState<VideoDTO[]>([]);
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [plans, setPlans] = useState<DayPlanView[]>([]);
  const [defaultTimes, setDefaultTimes] = useState<string[]>(["10:00", "18:00"]);
  const [pickedDate, setPickedDate] = useState("");
  const [draft, setDraft] = useState<DayDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [library, schedule] = await Promise.all([
      api<{ videos: VideoDTO[] }>("/api/videos"),
      api<{ timezone: string; defaultTimes: string[]; plans: DayPlanView[] }>("/api/scheduler/days"),
    ]);
    setVideos(library.videos);
    setTimezone(schedule.timezone);
    setDefaultTimes(schedule.defaultTimes);
    setPlans(schedule.plans);
  }

  useEffect(() => {
    load()
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setLoading(false));
  }, []);

  const queue = videos.filter((video) => video.isCanonical && QUEUE_STATUSES.has(video.status));
  const calendar = videos.filter((video) => video.scheduledAt || video.uploadedAt);

  async function reorder(ids: string[]) {
    const previous = videos;
    const order = new Map(ids.map((id, index) => [id, index]));
    setVideos((current) =>
      [...current].sort((a, b) => (order.get(a.id) ?? a.sortOrder) - (order.get(b.id) ?? b.sortOrder)),
    );
    try {
      await api("/api/scheduler/reorder", { method: "POST", body: JSON.stringify({ ids }) });
      await load();
      toast.success("Queue order saved. Slots were rebuilt.");
    } catch (error) {
      setVideos(previous);
      toast.error(error instanceof Error ? error.message : "Could not reorder");
    }
  }

  async function runDue() {
    setBusy(true);
    try {
      const result = await api<{ message: string }>("/api/scheduler/run", { method: "POST" });
      toast.success(result.message);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function openDay(date: string) {
    const plan = plans.find((item) => item.date === date);
    setDraft({
      date,
      times: plan ? plan.times : defaultTimes,
      custom: Boolean(plan),
    });
  }

  async function saveDay(date: string, times: string[]) {
    setSavingPlan(true);
    try {
      await api("/api/scheduler/days", {
        method: "PUT",
        body: JSON.stringify({ date, times }),
      });
      toast.success(
        times.length
          ? `${date} set for ${times.length} upload${times.length === 1 ? "" : "s"}.`
          : `${date} will not upload.`,
      );
      setDraft(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that date");
    } finally {
      setSavingPlan(false);
    }
  }

  async function resetDay(date: string) {
    setSavingPlan(true);
    try {
      await api(`/api/scheduler/days?date=${date}`, { method: "DELETE" });
      toast.success(`${date} is back on the everyday times.`);
      setDraft(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset that date");
    } finally {
      setSavingPlan(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading the schedule…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Scheduler</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Daily slots</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Pick any date and choose how many uploads that day should have, plus the clock time for each one. Days without a custom plan keep the everyday times from Settings. Drag the queue to change which video takes the next slot. Keep <span className="font-mono text-foreground">npm run worker</span> running.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={runDue}>
          {busy ? "Checking…" : "Upload due now"}
        </Button>
      </div>
      <ScheduleTimeline
        queue={queue}
        calendar={calendar}
        timezone={timezone}
        plans={plans}
        defaultTimes={defaultTimes}
        pickedDate={pickedDate}
        onPickedDate={setPickedDate}
        onEditDay={openDay}
        onReorder={reorder}
      />
      <DayPlanEditor draft={draft} busy={savingPlan} onClose={() => setDraft(null)} onSave={saveDay} onReset={resetDay} />
    </div>
  );
}
