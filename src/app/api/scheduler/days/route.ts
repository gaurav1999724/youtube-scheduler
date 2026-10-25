import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { assignSlots } from "@/lib/pipeline";
import { getResolvedSettings } from "@/lib/settings";
import { formatClock, parseClockList, parseUploadTimes } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const saveSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-26."),
  times: z.array(z.string()).max(12),
});

function normalizeTimes(times: string[]) {
  const clocks = parseClockList(times.join(","));
  if (clocks.length !== times.filter((time) => time.trim()).length) {
    throw new Error("Each time must be unique and look like 10:00 or 18:30.");
  }
  return clocks.map(formatClock);
}

export async function GET() {
  try {
    const settings = await getResolvedSettings();
    const plans = await prisma.dayPlan.findMany({ orderBy: { date: "asc" } });
    return NextResponse.json({
      timezone: settings.timezone,
      defaultTimes: parseUploadTimes(settings.uploadTimes, settings.dailyUploadCount).map(formatClock),
      plans: plans.map((plan) => ({
        date: plan.date,
        times: parseClockList(plan.times).map(formatClock),
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = saveSchema.parse(await request.json());
    const settings = await getResolvedSettings();
    const today = formatInTimeZone(new Date(), settings.timezone, "yyyy-MM-dd");
    if (body.date < today) {
      return NextResponse.json({ error: "Pick today or a future date." }, { status: 400 });
    }
    const times = normalizeTimes(body.times);
    await prisma.dayPlan.upsert({
      where: { date: body.date },
      create: { date: body.date, times: times.join(",") },
      update: { times: times.join(",") },
    });
    const scheduled = await assignSlots();
    return NextResponse.json({
      date: body.date,
      times,
      scheduled,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get("date") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "A date is required." }, { status: 400 });
    }
    await prisma.dayPlan.deleteMany({ where: { date } });
    const scheduled = await assignSlots();
    return NextResponse.json({ date, scheduled });
  } catch (error) {
    return toErrorResponse(error);
  }
}
