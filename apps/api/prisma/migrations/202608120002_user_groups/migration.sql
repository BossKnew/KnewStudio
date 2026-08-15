CREATE TABLE "UserGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserGroupMembership" (
  "userId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserGroupMembership_pkey" PRIMARY KEY ("userId", "groupId")
);

CREATE TABLE "ModelGroupAccess" (
  "modelId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  CONSTRAINT "ModelGroupAccess_pkey" PRIMARY KEY ("modelId", "groupId")
);

CREATE UNIQUE INDEX "UserGroup_name_key" ON "UserGroup"("name");
CREATE INDEX "UserGroupMembership_groupId_idx" ON "UserGroupMembership"("groupId");
CREATE INDEX "ModelGroupAccess_groupId_idx" ON "ModelGroupAccess"("groupId");

ALTER TABLE "UserGroupMembership" ADD CONSTRAINT "UserGroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserGroupMembership" ADD CONSTRAINT "UserGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelGroupAccess" ADD CONSTRAINT "ModelGroupAccess_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelGroupAccess" ADD CONSTRAINT "ModelGroupAccess_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
