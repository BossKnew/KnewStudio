UPDATE "Asset" AS asset
SET "role" = 'MASK', "jobId" = job."id"
FROM "GenerationJob" AS job
WHERE asset."id" = job."parameters"->>'maskAssetId'
  AND asset."role" = 'UPLOAD';
