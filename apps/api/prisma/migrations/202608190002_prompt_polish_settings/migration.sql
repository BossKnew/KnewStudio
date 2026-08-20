CREATE TABLE "PromptPolishSetting" (
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "systemPrompt" TEXT,
    "testCooldownUntil" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptPolishSetting_pkey" PRIMARY KEY ("id")
);
