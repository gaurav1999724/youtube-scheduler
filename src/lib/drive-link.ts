const FOLDER_ID = /^[\w-]{10,}$/;

/** Turn a raw folder id or any Drive share link into the folder id. */
export function parseDriveFolderId(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("Paste a Google Drive folder link.");
  if (FOLDER_ID.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a Google Drive folder link or the folder id.");
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host !== "drive.google.com" && host !== "docs.google.com") {
    throw new Error("Use a drive.google.com link. View-only and edit links both work.");
  }
  if (/\/file\/d\//.test(url.pathname)) {
    throw new Error("That link points at a file. Paste the folder link instead.");
  }

  const folderMatch = url.pathname.match(/\/folders\/([\w-]{10,})/);
  if (folderMatch) return folderMatch[1];

  const queryId = url.searchParams.get("id");
  if (queryId && FOLDER_ID.test(queryId)) return queryId;

  throw new Error("Could not find a folder id in that link.");
}

export function driveFolderLink(idOrLink: string) {
  return `https://drive.google.com/drive/folders/${parseDriveFolderId(idOrLink)}`;
}
