"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { driveFolderLink, parseDriveFolderId } from "@/lib/drive-link";
import type { DriveAuthMode, PrivacyStatus, PublicSettings } from "@/lib/types";

type FormState = {
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  serviceAccountJson: string;
  driveAuthMode: DriveAuthMode;
  driveFolderId: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiPrompt: string;
  dailyUploadCount: number;
  uploadTimes: string;
  timezone: string;
  privacyDefault: PrivacyStatus;
  madeForKids: boolean;
};

function toForm(settings: PublicSettings): FormState {
  return {
    googleClientId: settings.googleClientId,
    googleClientSecret: "",
    googleRefreshToken: "",
    serviceAccountJson: "",
    driveAuthMode: settings.driveAuthMode,
    driveFolderId: settings.driveFolderId ? driveFolderLink(settings.driveFolderId) : "",
    geminiApiKey: "",
    geminiModel: settings.geminiModel,
    geminiPrompt: settings.geminiPrompt,
    dailyUploadCount: settings.dailyUploadCount,
    uploadTimes: settings.uploadTimes,
    timezone: settings.timezone,
    privacyDefault: settings.privacyDefault,
    madeForKids: settings.madeForKids,
  };
}

export function SettingsView() {
  const params = useSearchParams();
  const toasted = useRef(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [flags, setFlags] = useState({ secret: false, token: false, account: false, gemini: false, connected: false, channelTitle: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function load() {
    const data = await api<{ settings: PublicSettings }>("/api/settings");
    setForm(toForm(data.settings));
    setFlags({
      secret: data.settings.hasGoogleClientSecret,
      token: data.settings.hasRefreshToken,
      account: data.settings.hasServiceAccount,
      gemini: data.settings.hasGeminiKey,
      connected: data.settings.connected,
      channelTitle: data.settings.channelTitle,
    });
  }

  useEffect(() => {
    load().catch((error: Error) => toast.error(error.message));
  }, []);

  useEffect(() => {
    if (toasted.current) return;
    const error = params.get("error");
    const connected = params.get("connected");
    if (!error && !connected) return;
    toasted.current = true;
    if (error) toast.error(error);
    if (connected) toast.success("YouTube channel connected.");
    load().catch(() => undefined);
  }, [params]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const data = await api<{ settings: PublicSettings }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      setForm(toForm(data.settings));
      toast.success("Settings saved.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  async function uploadNow() {
    setUploading(true);
    try {
      const result = await api<{ message: string }>("/api/videos/upload-next", { method: "POST" });
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (!form) return <p className="text-sm text-muted-foreground">Loading settings…</p>;

  let folderError = "";
  try {
    if (form.driveFolderId.trim()) parseDriveFolderId(form.driveFolderId);
  } catch (error) {
    folderError = error instanceof Error ? error.message : "Invalid Drive link.";
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Settings</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Channel and API</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Secrets are write-only. Leave a field blank to keep the saved value. Register the redirect{" "}
          <span className="font-mono text-foreground">http://localhost:3000/api/auth/google/callback</span>.
        </p>
      </div>
      <Tabs defaultValue="drive">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="drive">Drive</TabsTrigger>
          <TabsTrigger value="youtube">YouTube</TabsTrigger>
          <TabsTrigger value="gemini">Gemini</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
        </TabsList>
        <TabsContent value="drive">
          <Card>
            <CardHeader>
              <CardTitle>Google Drive</CardTitle>
            <CardDescription>
              Paste a view-only or edit share link. Save settings to replace the folder. The Google account, or the service account, still needs access to that folder.
            </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label>Drive auth</Label>
                <Select value={form.driveAuthMode} onValueChange={(value) => update("driveAuthMode", value as DriveAuthMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="oauth">OAuth refresh token</SelectItem>
                    <SelectItem value="service_account">Service account JSON</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="folder">Drive folder link</Label>
                <Input
                  id="folder"
                  value={form.driveFolderId}
                  placeholder="https://drive.google.com/drive/folders/..."
                  onChange={(event) => update("driveFolderId", event.target.value)}
                />
                <FolderLinkHint value={form.driveFolderId} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="client-id">Google client id</Label>
                <Input id="client-id" value={form.googleClientId} onChange={(event) => update("googleClientId", event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="client-secret">Google client secret</Label>
                <Input
                  id="client-secret"
                  type="password"
                  value={form.googleClientSecret}
                  placeholder={flags.secret ? "Configured — leave blank to keep" : "Not set"}
                  onChange={(event) => update("googleClientSecret", event.target.value)}
                />
              </div>
              {form.driveAuthMode === "service_account" && (
                <div className="grid gap-2">
                  <Label htmlFor="service-account">Service account JSON</Label>
                  <Textarea
                    id="service-account"
                    className="min-h-[180px] font-mono text-xs"
                    value={form.serviceAccountJson}
                    placeholder={flags.account ? "Configured — paste a new JSON file to replace it" : "Paste the service account key"}
                    onChange={(event) => update("serviceAccountJson", event.target.value)}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="youtube">
          <Card>
            <CardHeader>
              <CardTitle>YouTube channel</CardTitle>
              <CardDescription>
                {flags.connected ? `Connected as ${flags.channelTitle}.` : "Not connected yet."} Upload scope is sensitive, so the Google account must be a test user while the consent screen is in testing.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="refresh">Refresh token</Label>
                <Input
                  id="refresh"
                  type="password"
                  value={form.googleRefreshToken}
                  placeholder={flags.token ? "Configured — paste only to replace" : "Filled automatically by Connect YouTube"}
                  onChange={(event) => update("googleRefreshToken", event.target.value)}
                />
              </div>
              <Button asChild>
                <a href="/api/auth/google">Connect YouTube</a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="gemini">
          <Card>
            <CardHeader>
              <CardTitle>Gemini</CardTitle>
              <CardDescription>
                New keys should use gemini-3.8-flash. The prompt must ask for title, description, tags, category, playlist, and shortSummary.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="gemini-key">API key</Label>
                <Input
                  id="gemini-key"
                  type="password"
                  value={form.geminiApiKey}
                  placeholder={flags.gemini ? "Configured — leave blank to keep" : "Not set"}
                  onChange={(event) => update("geminiApiKey", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="model">Model</Label>
                <Input id="model" value={form.geminiModel} onChange={(event) => update("geminiModel", event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="prompt">Prompt</Label>
                <Textarea id="prompt" className="min-h-[220px] font-mono text-xs" value={form.geminiPrompt} onChange={(event) => update("geminiPrompt", event.target.value)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="schedule">
          <Card>
            <CardHeader>
              <CardTitle>Daily uploads</CardTitle>
              <CardDescription>
                The first N clock times are used, where N is the daily count. Add another time if you raise the count. Category is Film & Animation (id 1).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="count">Uploads per day</Label>
                  <Input
                    id="count"
                    type="number"
                    min={1}
                    max={12}
                    value={form.dailyUploadCount}
                    onChange={(event) => update("dailyUploadCount", Number(event.target.value))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="times">Time slots</Label>
                  <Input id="times" value={form.uploadTimes} onChange={(event) => update("uploadTimes", event.target.value)} placeholder="10:00,18:00" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input id="timezone" value={form.timezone} onChange={(event) => update("timezone", event.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Privacy default</Label>
                  <Select value={form.privacyDefault} onValueChange={(value) => update("privacyDefault", value as PrivacyStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="unlisted">Unlisted</SelectItem>
                      <SelectItem value="public">Public</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3">
                <div>
                  <p className="text-sm font-medium">Made for kids</p>
                  <p className="text-xs text-muted-foreground">YouTube treats this flag as permanent for that video. Leave it on only for a kids channel.</p>
                </div>
                <Switch checked={form.madeForKids} onCheckedChange={(checked) => update("madeForKids", checked)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={saving || uploading || Boolean(folderError)}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        <Button variant="outline" onClick={uploadNow} disabled={saving || uploading}>
          {uploading ? "Uploading…" : "Upload now"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Upload now takes the next video in the queue, writes the title, and publishes it with the same YouTube settings. It does not wait for the clock time.
      </p>
    </div>
  );
}

function FolderLinkHint({ value }: { value: string }) {
  if (!value.trim()) {
    return <p className="text-xs text-muted-foreground">Paste a view-only or edit link, then save to update the folder.</p>;
  }
  try {
    const id = parseDriveFolderId(value);
    const href = driveFolderLink(id);
    return (
      <p className="text-xs text-muted-foreground">
        Folder ready.{" "}
        <a className="text-primary hover:underline" href={href} target="_blank" rel="noreferrer">
          Open this Drive folder
        </a>
        . Paste a different link and save to replace it.
      </p>
    );
  } catch (error) {
    return <p className="text-xs text-red-300">{error instanceof Error ? error.message : "Invalid Drive link."}</p>;
  }
}
