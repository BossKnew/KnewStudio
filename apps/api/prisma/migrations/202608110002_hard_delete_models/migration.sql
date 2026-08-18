ALTER TABLE "GenerationJob" DROP CONSTRAINT "GenerationJob_modelId_fkey";
ALTER TABLE "GenerationJob" ALTER COLUMN "modelId" DROP NOT NULL;
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Remove records left behind by the old soft-delete behavior so the same
-- provider/model ID pair can be added again immediately after this migration.
DELETE FROM "Model" WHERE "archivedAt" IS NOT NULL;
ALTER TABLE "Model" DROP COLUMN "archivedAt";
