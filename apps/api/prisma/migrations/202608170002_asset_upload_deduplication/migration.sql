ALTER TABLE "Asset" ADD COLUMN "contentHash" TEXT;

CREATE INDEX "Asset_userId_role_contentHash_idx"
  ON "Asset"("userId", "role", "contentHash");

-- Active uploads are deduplicated per user. Soft-deleted assets remain available
-- as history tombstones and do not prevent the same content from being uploaded again.
CREATE UNIQUE INDEX "Asset_active_upload_contentHash_key"
  ON "Asset"("userId", "contentHash")
  WHERE "role" = 'UPLOAD' AND "deletedAt" IS NULL AND "contentHash" IS NOT NULL;
