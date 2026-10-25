-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "autotube";

-- CreateTable
CREATE TABLE "autotube"."Settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autotube"."DayPlan" (
    "date" TEXT NOT NULL,
    "times" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayPlan_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "autotube"."Video" (
    "id" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" TEXT,
    "driveModifiedAt" TIMESTAMP(3),
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
    "scheduledAt" TIMESTAMP(3),
    "privacyStatus" TEXT,
    "youtubeVideoId" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autotube"."UploadLog" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Video_driveFileId_key" ON "autotube"."Video"("driveFileId");

-- CreateIndex
CREATE INDEX "Video_status_scheduledAt_idx" ON "autotube"."Video"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Video_isCanonical_idx" ON "autotube"."Video"("isCanonical");

-- CreateIndex
CREATE INDEX "Video_duplicateOfId_idx" ON "autotube"."Video"("duplicateOfId");

-- CreateIndex
CREATE INDEX "UploadLog_createdAt_idx" ON "autotube"."UploadLog"("createdAt");

-- AddForeignKey
ALTER TABLE "autotube"."Video" ADD CONSTRAINT "Video_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "autotube"."Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autotube"."UploadLog" ADD CONSTRAINT "UploadLog_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "autotube"."Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

