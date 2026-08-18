ALTER TABLE "Asset" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Asset_userId_role_deletedAt_idx" ON "Asset"("userId", "role", "deletedAt");
