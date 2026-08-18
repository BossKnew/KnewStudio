ALTER TABLE "GenerationJob" ADD COLUMN "quotaReleased" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "UserUsage" (
  "userId" TEXT NOT NULL,
  "storageBytes" BIGINT NOT NULL DEFAULT 0,
  "activeJobs" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserUsage_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserUsage" ADD CONSTRAINT "UserUsage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "UserUsage" ("userId", "storageBytes", "activeJobs", "updatedAt")
SELECT u."id",
       COALESCE(SUM(CASE WHEN a."deletedAt" IS NULL THEN a."sizeBytes" ELSE 0 END), 0),
       COALESCE((SELECT COUNT(*)::INTEGER FROM "GenerationJob" j WHERE j."userId" = u."id" AND j."status" IN ('QUEUED', 'RUNNING')), 0),
       CURRENT_TIMESTAMP
FROM "User" u
LEFT JOIN "Asset" a ON a."userId" = u."id"
GROUP BY u."id";

UPDATE "GenerationJob" SET "quotaReleased" = true WHERE "status" NOT IN ('QUEUED', 'RUNNING');
UPDATE "User" SET "mustChangePwd" = true WHERE "role" = 'ADMIN';
