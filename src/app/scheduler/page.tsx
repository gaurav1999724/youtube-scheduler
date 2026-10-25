import type { Metadata } from "next";
import { SchedulerView } from "@/components/scheduler-view";

export const metadata: Metadata = { title: "Scheduler" };

export default function SchedulerPage() {
  return <SchedulerView />;
}
