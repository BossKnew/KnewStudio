ALTER TABLE "Provider"
  ADD COLUMN "testCooldownUntil" TIMESTAMP(3),
  ADD COLUMN "lastTestOk" BOOLEAN;
