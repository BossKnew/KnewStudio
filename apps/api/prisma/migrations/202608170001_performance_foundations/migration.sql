CREATE TABLE "GlobalUsage" (
  "id" TEXT NOT NULL,
  "activeJobs" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GlobalUsage_pkey" PRIMARY KEY ("id")
);

INSERT INTO "GlobalUsage" ("id", "activeJobs")
SELECT 'global', COUNT(*)::INTEGER
FROM "GenerationJob"
WHERE "status" IN ('QUEUED', 'RUNNING');

INSERT INTO "UserUsage" ("userId", "storageBytes", "activeJobs", "updatedAt")
SELECT
  u."id",
  COALESCE(a."storageBytes", 0),
  COALESCE(j."activeJobs", 0),
  CURRENT_TIMESTAMP
FROM "User" u
LEFT JOIN (
  SELECT "userId", SUM("sizeBytes") AS "storageBytes"
  FROM "Asset"
  WHERE "deletedAt" IS NULL AND "role" <> 'THUMBNAIL'
  GROUP BY "userId"
) a ON a."userId" = u."id"
LEFT JOIN (
  SELECT "userId", COUNT(*)::INTEGER AS "activeJobs"
  FROM "GenerationJob"
  WHERE "status" IN ('QUEUED', 'RUNNING')
  GROUP BY "userId"
) j ON j."userId" = u."id"
ON CONFLICT ("userId") DO UPDATE SET
  "storageBytes" = EXCLUDED."storageBytes",
  "activeJobs" = EXCLUDED."activeJobs",
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "Asset" ADD COLUMN "thumbnailForId" TEXT;
CREATE UNIQUE INDEX "Asset_thumbnailForId_key" ON "Asset"("thumbnailForId");
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_thumbnailForId_fkey"
  FOREIGN KEY ("thumbnailForId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "User_createdAt_id_idx" ON "User"("createdAt", "id");
CREATE INDEX "Conversation_userId_updatedAt_id_idx" ON "Conversation"("userId", "updatedAt", "id");
CREATE INDEX "GenerationJob_conversationId_createdAt_id_idx" ON "GenerationJob"("conversationId", "createdAt", "id");
CREATE INDEX "Asset_userId_deletedAt_createdAt_id_idx" ON "Asset"("userId", "deletedAt", "createdAt", "id");

DROP INDEX IF EXISTS "Conversation_userId_updatedAt_idx";
DROP INDEX IF EXISTS "GenerationJob_conversationId_createdAt_idx";
