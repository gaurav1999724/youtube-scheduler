"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Clapperboard, Film, LayoutDashboard, Settings, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/queue", label: "Library", icon: Film },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/scheduler", label: "Scheduler", icon: CalendarClock },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-card/80 backdrop-blur md:flex">
        <div className="flex items-center gap-3 px-6 py-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Clapperboard className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">AutoTube</p>
            <p className="text-xs text-muted-foreground">AI Studio</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {links.map((link) => {
            const active = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  active && "bg-accent text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
        <p className="px-6 py-5 text-xs leading-5 text-muted-foreground">
          Local studio. API keys and refresh tokens stay on this machine.{" "}
          <button
            type="button"
            className="underline-offset-4 hover:underline"
            onClick={() => {
              fetch("/api/auth/session", { method: "DELETE" }).finally(() => {
                window.location.assign("/login");
              });
            }}
          >
            Sign out
          </button>
        </p>
      </aside>
      <div className="md:pl-64">
        <header className="sticky top-0 z-20 flex gap-2 overflow-x-auto border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-full px-3 py-1 text-sm text-muted-foreground",
                pathname === link.href && "bg-accent text-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
