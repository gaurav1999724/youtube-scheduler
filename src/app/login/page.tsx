import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginView } from "@/components/login-view";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <LoginView />
    </Suspense>
  );
}
