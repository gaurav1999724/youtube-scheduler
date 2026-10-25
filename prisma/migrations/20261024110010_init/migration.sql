-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "googleClientId" TEXT,
    "googleClientSecret" TEXT,
    "googleRefreshToken" TEXT,
    "serviceAccountJson" TEXT,
    "driveAuthMode" TEXT NOT NULL DEFAULT 'oauth',
    "driveFolderId" TEXT NOT NULL DEFAULT '1sS5RLXEKdz4Cb3K9vPp_sxKO75Ds36CL',
    "geminiApiKey" TEXT,
    "geminiModel" TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
    "geminiPrompt" TEXT NOT NULL,
    "dailyUploadCount" INTEGER NOT NULL DEFAULT 2,
    "uploadTimes" TEXT NOT NULL DEFAULT '10:00,18:00',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "privacyDefault" TEXT NOT NULL DEFAULT 'private',
    "madeForKids" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" TEXT NOT NULL DEFAULT '1',
    "channelId" TEXT,
    "channelTitle" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driveFileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" TEXT,
    "driveModifiedAt" DATETIME,
    "localPath" TEXT,
    "thumbPath" TEXT,
    "fingerprint" TEXT,
    "duplicateOfId" TEXT,
    "isCanonical" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'discovered',
    "title" TEXT,
    "description" TEXT,
    "tags" TEXT,
    "category" TEXT,
    "playlist" TEXT,
    "shortSummary" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" DATETIME,
    "privacyStatus" TEXT,
    "youtubeVideoId" TEXT,
    "uploadedAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Video_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Video" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UploadLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadLog_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Video_driveFileId_key" ON "Video"("driveFileId");

-- CreateIndex
CREATE INDEX "Video_status_scheduledAt_idx" ON "Video"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Video_isCanonical_idx" ON "Video"("isCanonical");

-- CreateIndex
CREATE INDEX "Video_duplicateOfId_idx" ON "Video"("duplicateOfId");

-- CreateIndex
CREATE INDEX "UploadLog_createdAt_idx" ON "UploadLog"("createdAt");
