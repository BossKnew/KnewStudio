CREATE TABLE "AssetShare" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sharedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetShare_assetId_groupId_key" ON "AssetShare"("assetId", "groupId");
CREATE INDEX "AssetShare_groupId_createdAt_id_idx" ON "AssetShare"("groupId", "createdAt", "id");
CREATE INDEX "AssetShare_sharedById_idx" ON "AssetShare"("sharedById");

ALTER TABLE "AssetShare" ADD CONSTRAINT "AssetShare_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetShare" ADD CONSTRAINT "AssetShare_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetShare" ADD CONSTRAINT "AssetShare_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
