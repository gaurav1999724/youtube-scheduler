"use client";

import { CSS } from "@dnd-kit/utilities";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATUS_LABEL, type VideoDTO } from "@/lib/types";

export type DayPlanView = { date: string; times: string[] };

function shiftDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return utc.toISOString().slice(0, 10);
}

function dayMeta(date: string, timezone: string) {
  const noon = fromZonedTime(`${date} 12:00:00`, timezone);
  return {
    key: date,
    label: formatInTimeZone(noon, timezone, "EEE"),
    dateLabel: formatInTimeZone(noon, timezone, "d MMM"),
  };
}

function visibleDays(timezone: string, plans: DayPlanView[]) {
  const start = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const days = Array.from({ length: 7 }, (_, index) => dayMeta(shiftDate(start, index), timezone));
  const seen = new Set(days.map((day) => day.key));
  for (const plan of plans) {
    if (plan.date >= start && !seen.has(plan.date)) {
      seen.add(plan.date);
      days.push(dayMeta(plan.date, timezone));
    }
  }
  days.sort((a, b) => a.key.localeCompare(b.key));
  return days;
}

function prettyTime(value: string) {
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 || 12;
  return `${display}:${minute} ${suffix}`;
}

function SortableRow({ video, timezone }: { video: VideoDTO; timezone: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: video.id,
    disabled: video.status === "uploading" || video.status === "uploaded",
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const when = video.scheduledAt
    ? formatInTimeZone(new Date(video.scheduledAt), timezone, "EEE d MMM · h:mm a")
    : video.status === "ready"
      ? "Waiting for a slot"
      : "Not scheduled. A clock time stays empty until processing gives this video a title.";
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 ${isDragging ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground disabled:cursor-not-allowed"
        aria-label={`Reorder ${video.title || video.name}`}
        disabled={video.status === "uploading" || video.status === "uploaded"}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{video.title || video.name}</p>
        <p className="text-xs text-muted-foreground">{when}</p>
      </div>
      <Badge variant="secondary">{STATUS_LABEL[video.status] || video.status}</Badge>
      <Badge variant="outline">{video.privacyStatus || "private"}</Badge>
    </div>
  );
}

export function ScheduleTimeline({
  queue,
  calendar,
  timezone,
  plans,
  defaultTimes,
  pickedDate,
  onPickedDate,
  onEditDay,
  onReorder,
  waitingCount = 0,
}: {
  queue: VideoDTO[];
  calendar: VideoDTO[];
  timezone: string;
  plans: DayPlanView[];
  defaultTimes: string[];
  pickedDate: string;
  onPickedDate: (date: string) => void;
  onEditDay: (date: string) => void;
  onReorder: (ids: string[]) => void;
  waitingCount?: number;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const days = visibleDays(timezone, plans);
  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = queue.findIndex((video) => video.id === active.id);
    const newIndex = queue.findIndex((video) => video.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(queue, oldIndex, newIndex).map((video) => video.id));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">Queue</h2>
        {queue.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
            No video is on a clock time yet. Sync the Drive folder, then process the library. A saved time such as 12:32 PM stays open until a video has a title.
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={queue.map((video) => video.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {waitingCount > queue.length ? (
                  <p className="text-xs text-muted-foreground">
                    Showing {queue.length} of {waitingCount} videos still waiting to be processed. They are not placed on a clock time until a title is written.
                  </p>
                ) : null}
                {queue.map((video) => (
                  <SortableRow key={video.id} video={video} timezone={timezone} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">Dates</h2>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (pickedDate) onEditDay(pickedDate);
            }}
          >
            <Input
              type="date"
              min={today}
              value={pickedDate}
              aria-label="Choose a date to plan"
              className="h-9 w-40"
              onChange={(event) => onPickedDate(event.target.value)}
            />
            <Button type="submit" size="sm" variant="outline" disabled={!pickedDate}>
              Plan this date
            </Button>
          </form>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {days.map((day) => {
            const items = calendar.filter((video) => {
              const stamp = video.scheduledAt || video.uploadedAt;
              if (!stamp) return false;
              return formatInTimeZone(new Date(stamp), timezone, "yyyy-MM-dd") === day.key;
            });
            const custom = plans.find((plan) => plan.date === day.key);
            const times = custom ? custom.times : defaultTimes;
            return (
              <div key={day.key} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{day.label}</p>
                    <p className="text-sm font-medium">{day.dateLabel}</p>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => onEditDay(day.key)}>
                    Set times
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {custom && <Badge variant="default" className="mr-2">Custom</Badge>}
                  {times.length === 0
                    ? "No uploads"
                    : `${times.length} upload${times.length === 1 ? "" : "s"} · ${times.map(prettyTime).join(", ")}`}
                </p>
                <div className="mt-3 space-y-2">
                  {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Open</p>
                  ) : (
                    items.map((video) => (
                      <div key={video.id} className="rounded-lg bg-secondary px-2 py-2">
                        <p className="truncate text-sm">{video.title || video.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {video.scheduledAt
                            ? formatInTimeZone(new Date(video.scheduledAt), timezone, "h:mm a")
                            : STATUS_LABEL[video.status]}
                          {" · "}
                          {video.privacyStatus || "private"}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
