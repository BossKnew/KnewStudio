ALTER TABLE "PromptPolishSetting" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
UPDATE "PromptPolishSetting" SET "name" = '默认供应商' WHERE "name" = '';
