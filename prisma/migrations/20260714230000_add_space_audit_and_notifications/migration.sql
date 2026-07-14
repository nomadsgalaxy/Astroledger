-- Space-scoped append-only audit trail + per-user in-app notifications.
-- Additive only; no backfill needed (history starts at deployment).

-- CreateTable
CREATE TABLE "SpaceAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "summary" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "reason" TEXT
);

-- CreateTable
CREATE TABLE "SpaceNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "linkPath" TEXT,
    "readAt" DATETIME
);

-- CreateIndex
CREATE INDEX "SpaceAuditEvent_spaceId_at_idx" ON "SpaceAuditEvent"("spaceId", "at");

-- CreateIndex
CREATE INDEX "SpaceNotification_userId_readAt_idx" ON "SpaceNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "SpaceNotification_spaceId_at_idx" ON "SpaceNotification"("spaceId", "at");

