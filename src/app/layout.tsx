import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { Toaster } from "sonner";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: {
    default: "AutoTube AI Studio",
    template: "%s · AutoTube",
  },
  description: "Drive sync, duplicate detection, Gemini SEO, and scheduled YouTube uploads.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <AppShell>{children}</AppShell>
        <Toaster theme="dark" position="top-right" />
      </body>
    </html>
  );
}
