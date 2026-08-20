ALTER TABLE "UserGroup" ADD COLUMN "quotaWindow" TEXT;
ALTER TABLE "UserGroup" ADD COLUMN "quotaImages" INTEGER;

ALTER TABLE "GenerationJob" ADD COLUMN "imageCount" INTEGER NOT NULL DEFAULT 1;

UPDATE "GenerationJob"
SET "imageCount" = GREATEST(1, LEAST(4, ("parameters" ->> 'count')::int))
WHERE jsonb_typeof("parameters" -> 'count') = 'number';

CREATE TABLE "QuotaEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "modelId" TEXT,
    "imageCount" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuotaEvent_userId_createdAt_idx" ON "QuotaEvent"("userId", "createdAt");
CREATE INDEX "QuotaEvent_jobId_idx" ON "QuotaEvent"("jobId");
CREATE INDEX "QuotaEvent_createdAt_idx" ON "QuotaEvent"("createdAt");

ALTER TABLE "QuotaEvent" ADD CONSTRAINT "QuotaEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuotaEvent" ADD CONSTRAINT "QuotaEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
