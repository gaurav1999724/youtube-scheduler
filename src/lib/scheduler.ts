import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { ResolvedSettings } from "@/lib/settings";

export type ClockTime = { hour: number; minute: number };

export type DayPlanSlot = { date: string; times: string };

export function parseClockList(raw: string): ClockTime[] {
  const parsed: ClockTime[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(part.trim());
    if (!match) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) continue;
    const key = `${hour}:${minute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ hour, minute });
  }
  parsed.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  return parsed;
}

export function formatClock(time: ClockTime) {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

export function parseUploadTimes(raw: string, limit: number): ClockTime[] {
  const parsed = parseClockList(raw);
  const capped = Math.max(1, Math.min(12, limit));
  const times = (parsed.length ? parsed : [{ hour: 10, minute: 0 }, { hour: 18, minute: 0 }]).slice(0, capped);
  return times;
}

export function timesForDate(date: string, settings: ResolvedSettings, plans: DayPlanSlot[]): ClockTime[] {
  const custom = plans.find((plan) => plan.date === date);
  if (custom) return parseClockList(custom.times);
  return parseUploadTimes(settings.uploadTimes, settings.dailyUploadCount);
}

export function uploadCapForDate(date: string, settings: ResolvedSettings, plans: DayPlanSlot[]) {
  return timesForDate(date, settings, plans).length;
}

function shiftDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function generateSlots(
  settings: ResolvedSettings,
  count: number,
  plans: DayPlanSlot[] = [],
  from = new Date(),
): Date[] {
  if (count <= 0) return [];
  const timezone = settings.timezone || "Asia/Kolkata";
  const start = formatInTimeZone(from, timezone, "yyyy-MM-dd");
  const slots: Date[] = [];
  for (let day = 0; day < 400 && slots.length < count; day += 1) {
    const date = shiftDate(start, day);
    const times = timesForDate(date, settings, plans);
    for (const time of times) {
      const hh = String(time.hour).padStart(2, "0");
      const mm = String(time.minute).padStart(2, "0");
      const slot = fromZonedTime(`${date} ${hh}:${mm}:00`, timezone);
      if (slot.getTime() > from.getTime() + 5000) slots.push(slot);
      if (slots.length >= count) break;
    }
  }
  if (slots.length < count) {
    throw new Error("Could not build enough future upload slots.");
  }
  return slots;
}

export function dayBounds(timezone: string, now = new Date()) {
  const date = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  return {
    start: fromZonedTime(`${date} 00:00:00`, timezone),
    end: fromZonedTime(`${date} 23:59:59`, timezone),
  };
}

export const PUBLIC_EARLY_WINDOW_MS = 15 * 60 * 1000;
