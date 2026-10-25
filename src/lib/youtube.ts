import fs from "fs";
import { google } from "googleapis";
import { getAuthorizedYouTube } from "@/lib/google-auth";
import { saveChannel } from "@/lib/settings";
import { errorMessage, type PrivacyStatus } from "@/lib/types";

type Youtube = ReturnType<typeof google.youtube>;

export function fitTags(tags: string[]) {
  const fitted: string[] = [];
  let used = 0;
  for (const tag of tags) {
    const clean = tag.replace(/^#/, "").trim();
    if (!clean) continue;
    if (used + clean.length + (fitted.length ? 1 : 0) > 480) break;
    fitted.push(clean.slice(0, 80));
    used += clean.length + 1;
    if (fitted.length >= 15) break;
  }
  return fitted;
}

export function youtubeStatus(options: {
  privacy: PrivacyStatus;
  scheduledAt?: Date | null;
  madeForKids: boolean;
}) {
  const futurePublic =
    options.privacy === "public" &&
    options.scheduledAt &&
    options.scheduledAt.getTime() > Date.now() + 30_000;
  return {
    privacyStatus: futurePublic ? "private" : options.privacy,
    ...(futurePublic ? { publishAt: options.scheduledAt!.toISOString() } : {}),
    selfDeclaredMadeForKids: options.madeForKids,
  };
}

async function findOrCreatePlaylist(youtube: Youtube, title: string) {
  let pageToken: string | undefined;
  do {
    const listed = await youtube.playlists.list({
      part: ["snippet"],
      mine: true,
      maxResults: 50,
      pageToken,
    });
    const found = listed.data.items?.find((item) => item.snippet?.title === title);
    if (found?.id) return found.id;
    pageToken = listed.data.nextPageToken ?? undefined;
  } while (pageToken);

  const created = await youtube.playlists.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title, description: "Created by AutoTube AI Studio" },
      status: { privacyStatus: "public" },
    },
  });
  if (!created.data.id) throw new Error(`Could not create the playlist "${title}".`);
  return created.data.id;
}

export async function uploadToYouTube(input: {
  videoPath: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacy: PrivacyStatus;
  scheduledAt?: Date | null;
  madeForKids: boolean;
  playlist?: string | null;
}) {
  const youtube = await getAuthorizedYouTube();
  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: input.title.slice(0, 100),
        description: input.description.slice(0, 5000),
        tags: fitTags(input.tags),
        categoryId: input.categoryId || "1",
      },
      status: youtubeStatus({
        privacy: input.privacy,
        scheduledAt: input.scheduledAt,
        madeForKids: input.madeForKids,
      }),
    },
    media: {
      body: fs.createReadStream(input.videoPath),
    },
  });
  const videoId = response.data.id;
  if (!videoId) throw new Error("YouTube did not return a video id.");

  let playlistWarning = "";
  if (input.playlist?.trim()) {
    try {
      const playlistId = await findOrCreatePlaylist(youtube, input.playlist.trim());
      await youtube.playlistItems.insert({
        part: ["snippet"],
        requestBody: {
          snippet: {
            playlistId,
            resourceId: { kind: "youtube#video", videoId },
          },
        },
      });
    } catch (error) {
      playlistWarning = errorMessage(error);
    }
  }

  return { id: videoId, playlistWarning };
}

export async function fetchYouTubeChannel() {
  const youtube = await getAuthorizedYouTube();
  const response = await youtube.channels.list({
    part: ["snippet", "statistics"],
    mine: true,
  });
  const channel = response.data.items?.[0];
  if (!channel?.id) throw new Error("No YouTube channel was found for this Google account.");
  const title = channel.snippet?.title || "YouTube channel";
  await saveChannel(channel.id, title);
  return {
    id: channel.id,
    title,
    thumbnail: channel.snippet?.thumbnails?.default?.url || "",
    subscriberCount: channel.statistics?.subscriberCount || null,
  };
}
