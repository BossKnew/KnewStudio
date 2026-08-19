CREATE TABLE "PromptEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromptEntry_userId_prompt_key" ON "PromptEntry"("userId", "prompt");
CREATE INDEX "PromptEntry_userId_isFavorite_lastUsedAt_id_idx" ON "PromptEntry"("userId", "isFavorite", "lastUsedAt", "id");
CREATE INDEX "PromptEntry_userId_lastUsedAt_id_idx" ON "PromptEntry"("userId", "lastUsedAt", "id");

ALTER TABLE "PromptEntry" ADD CONSTRAINT "PromptEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
