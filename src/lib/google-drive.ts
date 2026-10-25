import fs from "fs";
import path from "path";
import { getDriveClient } from "@/lib/google-auth";
import { assertSafeDriveId } from "@/lib/paths";

export type DriveVideoFile = {
  id: string;
  name: string;
  mimeType: string;
  size: string | null;
  modifiedTime: string | null;
};

export async function listDriveVideos(folderId: string): Promise<DriveVideoFile[]> {
  assertSafeDriveId(folderId);
  const drive = await getDriveClient();
  const files: DriveVideoFile[] = [];
  let pageToken: string | undefined;
  const query = [
    `'${folderId}' in parents`,
    "trashed = false",
    "(mimeType = 'video/mp4' or mimeType = 'video/quicktime' or mimeType = 'video/x-matroska' or mimeType = 'video/mkv')",
  ].join(" and ");

  do {
    const response = await drive.files.list({
      q: query,
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime)",
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const file of response.data.files ?? []) {
      if (!file.id || !file.name || !file.mimeType) continue;
      files.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size ?? null,
        modifiedTime: file.modifiedTime ?? null,
      });
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  files.sort((a, b) => (a.modifiedTime ?? "").localeCompare(b.modifiedTime ?? ""));
  return files;
}

export async function downloadDriveFile(fileId: string, dest: string) {
  assertSafeDriveId(fileId);
  const drive = await getDriveClient();
  const response = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" },
  );
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const temp = `${dest}.part`;
  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(temp);
    response.data
      .on("error", reject)
      .pipe(writer)
      .on("finish", () => resolve())
      .on("error", reject);
  });
  await fs.promises.rename(temp, dest);
}
