CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED', 'DELETING');
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO');
CREATE TYPE "GenerationMode" AS ENUM ('TEXT_TO_IMAGE', 'IMAGE_EDIT', 'INPAINT');
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "AssetRole" AS ENUM ('UPLOAD', 'MASK', 'OUTPUT', 'THUMBNAIL');

CREATE TABLE "User" (
  "id" TEXT NOT NULL, "username" TEXT NOT NULL, "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'USER', "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
  "mustChangePwd" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SystemSetting" (
  "key" TEXT NOT NULL, "value" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
CREATE TABLE "Provider" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "baseUrl" TEXT NOT NULL, "adapterKind" TEXT NOT NULL DEFAULT 'openai-images', "encryptedApiKey" TEXT NOT NULL,
  "encryptedHeaders" TEXT, "timeoutSeconds" INTEGER NOT NULL DEFAULT 180, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Model" (
  "id" TEXT NOT NULL, "providerId" TEXT NOT NULL, "displayName" TEXT NOT NULL, "upstreamModelId" TEXT NOT NULL,
  "mediaKind" "MediaKind" NOT NULL DEFAULT 'IMAGE', "supportsGeneration" BOOLEAN NOT NULL DEFAULT true,
  "supportsEdit" BOOLEAN NOT NULL DEFAULT false, "supportsInpaint" BOOLEAN NOT NULL DEFAULT false,
  "allowedSizes" JSONB NOT NULL, "allowedQualities" JSONB NOT NULL, "maxImages" INTEGER NOT NULL DEFAULT 1,
  "maxInputImages" INTEGER NOT NULL DEFAULT 1, "defaults" JSONB NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0, "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Model_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "title" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "GenerationJob" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "modelId" TEXT NOT NULL,
  "mediaKind" "MediaKind" NOT NULL DEFAULT 'IMAGE', "mode" "GenerationMode" NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'QUEUED', "prompt" TEXT NOT NULL, "parameters" JSONB NOT NULL,
  "modelSnapshot" JSONB NOT NULL, "errorCode" TEXT, "errorMessage" TEXT, "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Asset" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "jobId" TEXT, "role" "AssetRole" NOT NULL,
  "mediaKind" "MediaKind" NOT NULL DEFAULT 'IMAGE', "objectKey" TEXT NOT NULL, "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL, "width" INTEGER, "height" INTEGER, "originalName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL, "actorId" TEXT, "action" TEXT NOT NULL, "targetType" TEXT NOT NULL,
  "targetId" TEXT, "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_status_idx" ON "User"("status");
CREATE UNIQUE INDEX "Provider_name_key" ON "Provider"("name");
CREATE INDEX "Model_enabled_sortOrder_idx" ON "Model"("enabled", "sortOrder");
CREATE UNIQUE INDEX "Model_providerId_upstreamModelId_key" ON "Model"("providerId", "upstreamModelId");
CREATE INDEX "Conversation_userId_updatedAt_idx" ON "Conversation"("userId", "updatedAt");
CREATE INDEX "GenerationJob_userId_createdAt_idx" ON "GenerationJob"("userId", "createdAt");
CREATE INDEX "GenerationJob_conversationId_createdAt_idx" ON "GenerationJob"("conversationId", "createdAt");
CREATE INDEX "GenerationJob_status_idx" ON "GenerationJob"("status");
CREATE UNIQUE INDEX "Asset_objectKey_key" ON "Asset"("objectKey");
CREATE INDEX "Asset_userId_createdAt_idx" ON "Asset"("userId", "createdAt");
CREATE INDEX "Asset_jobId_idx" ON "Asset"("jobId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

ALTER TABLE "Model" ADD CONSTRAINT "Model_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
