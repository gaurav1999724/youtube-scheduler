"use client";

import { useEffect, useState } from "react";
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

export type DayDraft = {
  date: string;
  times: string[];
  custom: boolean;
};

function suggestNext(previous?: string) {
  if (!previous) return "10:00";
  const [hour, minute] = previous.split(":").map(Number);
  const total = Math.min(hour * 60 + minute + 180, 23 * 60 + 30);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function DayPlanEditor({
  draft,
  busy,
  onClose,
  onSave,
  onReset,
}: {
  draft: DayDraft | null;
  busy: boolean;
  onClose: () => void;
  onSave: (date: string, times: string[]) => Promise<void>;
  onReset: (date: string) => Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [times, setTimes] = useState<string[]>([]);

  useEffect(() => {
    if (!draft) return;
    setDate(draft.date);
    setTimes([...draft.times]);
  }, [draft]);

  const duplicates = times.filter((time, index) => times.indexOf(time) !== index);
  const count = times.length;

  function setCount(nextCount: number) {
    const safe = Math.max(0, Math.min(12, nextCount));
    setTimes((current) => {
      const next = [...current];
      while (next.length < safe) next.push(suggestNext(next[next.length - 1]));
      return next.slice(0, safe);
    });
  }

  return (
    <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Uploads for this date</DialogTitle>
          <DialogDescription>
            Choose how many videos go out on this date, then set the clock time for each one. Those times become the scheduled publish times.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="plan-date">Date</Label>
            <Input id="plan-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="plan-count">How many uploads</Label>
            <Input
              id="plan-count"
              type="number"
              min={0}
              max={12}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </div>
          {count === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing will be scheduled on this date.</p>
          ) : (
            <div className="grid gap-2">
              <Label>Times</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {times.map((time, index) => (
                  <Input
                    key={index}
                    type="time"
                    value={time}
                    aria-label={`Upload ${index + 1} time`}
                    onChange={(event) =>
                      setTimes((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
                    }
                  />
                ))}
              </div>
            </div>
          )}
          {duplicates.length > 0 && <p className="text-sm text-red-300">Each upload needs its own time.</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !date || duplicates.length > 0} onClick={() => onSave(date, times)}>
              {busy ? "Saving…" : "Save this date"}
            </Button>
            {draft?.custom && (
              <Button variant="outline" disabled={busy} onClick={() => onReset(draft.date)}>
                Use everyday default
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
