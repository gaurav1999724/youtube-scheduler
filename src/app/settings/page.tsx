import { Suspense } from "react";
import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading settings…</p>}>
      <SettingsView />
    </Suspense>
  );
}
