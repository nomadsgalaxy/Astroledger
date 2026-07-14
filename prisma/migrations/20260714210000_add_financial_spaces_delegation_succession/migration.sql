-- Durable financial ownership boundaries, account grants, encrypted document
-- metadata, dependent stewardship, and succession planning.

DROP INDEX "BillOccurrence_sourceType_sourceId_dueDate_key";
DROP INDEX "Envelope_monthYear_name_key";
DROP INDEX "NetWorthSnapshot_capturedAt_key";
DROP INDEX "Order_source_externalId_key";
DROP INDEX "Subscription_merchant_cadenceDays_amount_key";
DROP INDEX "Category_name_key";
DROP INDEX "Tag_parentId_name_key";

ALTER TABLE "AuditLog" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "BankAccount" ADD COLUMN "ownerSpaceId" TEXT;
ALTER TABLE "BillOccurrence" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Budget" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Category" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Envelope" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Forecast" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Goal" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Institution" ADD COLUMN "ownerSpaceId" TEXT;
ALTER TABLE "MileageLog" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "NetWorthSnapshot" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Order" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Plan" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Rule" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Scenario" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Schedule" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "SpendingAlert" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "TaxBucket" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "Tag" ADD COLUMN "spaceId" TEXT;

CREATE TABLE "FinancialSpace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'personal',
    "householdId" TEXT,
    "beneficiaryUserId" TEXT,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "FinancialSpaceMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "canManageDocuments" BOOLEAN NOT NULL DEFAULT false,
    "canExport" BOOLEAN NOT NULL DEFAULT false,
    "canInvite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FinancialSpaceMember_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "FinancialSpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FinancialSpaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AccountGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "granteeUserId" TEXT,
    "granteeSpaceId" TEXT,
    "accessLevel" TEXT NOT NULL DEFAULT 'view',
    "documentAccess" TEXT NOT NULL DEFAULT 'none',
    "canExport" BOOLEAN NOT NULL DEFAULT false,
    "canShare" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME,
    "grantedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountGrant_exactly_one_grantee" CHECK (("granteeUserId" IS NOT NULL AND "granteeSpaceId" IS NULL) OR ("granteeUserId" IS NULL AND "granteeSpaceId" IS NOT NULL))
);

CREATE TABLE "FinancialSpaceInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "canManageDocuments" BOOLEAN NOT NULL DEFAULT false,
    "canExport" BOOLEAN NOT NULL DEFAULT false,
    "canInvite" BOOLEAN NOT NULL DEFAULT false,
    "invitedById" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FinancialSpaceInvite_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "FinancialSpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "FinancialDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "accountId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "notes" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FinancialDocument_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "FinancialSpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FinancialDocument_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SpaceSuccessionPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minimumApprovals" INTEGER NOT NULL DEFAULT 1,
    "waitingPeriodDays" INTEGER NOT NULL DEFAULT 30,
    "instructions" TEXT,
    "infrastructureChecklist" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaceSuccessionPlan_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "FinancialSpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SpaceSuccessor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'nominated',
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaceSuccessor_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SpaceSuccessionPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SuccessionRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "executeAfter" DATETIME NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SuccessionRequest_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SpaceSuccessionPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SuccessionApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'approve',
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuccessionApproval_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SuccessionRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Compatibility backfill. Existing ledgers become the household's shared
-- space; every user also gets an empty private space for future accounts.
INSERT INTO "FinancialSpace" ("id", "name", "kind", "householdId", "createdById", "status", "createdAt", "updatedAt")
SELECT 'space_hh_' || h."id", h."name" || ' Finances', 'household', h."id",
       COALESCE((SELECT hm."userId" FROM "HouseholdMember" hm WHERE hm."householdId" = h."id" AND hm."role" = 'owner' ORDER BY hm."createdAt" LIMIT 1),
                (SELECT hm."userId" FROM "HouseholdMember" hm WHERE hm."householdId" = h."id" ORDER BY hm."createdAt" LIMIT 1),
                'system'),
       'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Household" h;

INSERT INTO "FinancialSpace" ("id", "name", "kind", "beneficiaryUserId", "createdById", "status", "createdAt", "updatedAt")
SELECT 'space_personal_' || u."id", COALESCE(NULLIF(u."name", ''), u."email") || '''s Finances', 'personal', u."id", u."id", 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u;

INSERT INTO "FinancialSpaceMember" ("id", "spaceId", "userId", "role", "canManageDocuments", "canExport", "canInvite", "createdAt", "updatedAt")
SELECT 'fsm_hh_' || hm."id", 'space_hh_' || hm."householdId", hm."userId",
       CASE WHEN hm."role" = 'owner' THEN 'owner' ELSE 'manager' END,
       true, true, CASE WHEN hm."role" = 'owner' THEN true ELSE false END,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "HouseholdMember" hm;

INSERT INTO "FinancialSpaceMember" ("id", "spaceId", "userId", "role", "canManageDocuments", "canExport", "canInvite", "createdAt", "updatedAt")
SELECT 'fsm_personal_' || u."id", 'space_personal_' || u."id", u."id", 'owner', true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u;

UPDATE "Institution" SET "ownerSpaceId" = COALESCE((SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1), (SELECT "id" FROM "FinancialSpace" ORDER BY "createdAt" LIMIT 1));
UPDATE "BankAccount" SET "ownerSpaceId" = COALESCE((SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1), (SELECT "id" FROM "FinancialSpace" ORDER BY "createdAt" LIMIT 1));
UPDATE "AuditLog" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "BillOccurrence" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Budget" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Category" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Envelope" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Forecast" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Goal" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "MileageLog" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "NetWorthSnapshot" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Order" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Plan" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Recommendation" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Rule" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Scenario" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Schedule" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "SpendingAlert" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Subscription" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "TaxBucket" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);
UPDATE "Tag" SET "spaceId" = (SELECT "id" FROM "FinancialSpace" WHERE "kind" = 'household' ORDER BY "createdAt" LIMIT 1);

CREATE INDEX "FinancialSpace_householdId_idx" ON "FinancialSpace"("householdId");
CREATE INDEX "FinancialSpace_beneficiaryUserId_idx" ON "FinancialSpace"("beneficiaryUserId");
CREATE INDEX "FinancialSpace_status_idx" ON "FinancialSpace"("status");
CREATE INDEX "FinancialSpaceMember_userId_idx" ON "FinancialSpaceMember"("userId");
CREATE UNIQUE INDEX "FinancialSpaceMember_spaceId_userId_key" ON "FinancialSpaceMember"("spaceId", "userId");
CREATE UNIQUE INDEX "FinancialSpaceInvite_spaceId_email_key" ON "FinancialSpaceInvite"("spaceId", "email");
CREATE INDEX "FinancialSpaceInvite_email_expiresAt_idx" ON "FinancialSpaceInvite"("email", "expiresAt");
CREATE INDEX "AccountGrant_granteeUserId_idx" ON "AccountGrant"("granteeUserId");
CREATE INDEX "AccountGrant_granteeSpaceId_idx" ON "AccountGrant"("granteeSpaceId");
CREATE INDEX "AccountGrant_expiresAt_idx" ON "AccountGrant"("expiresAt");
CREATE UNIQUE INDEX "AccountGrant_accountId_granteeUserId_key" ON "AccountGrant"("accountId", "granteeUserId");
CREATE UNIQUE INDEX "AccountGrant_accountId_granteeSpaceId_key" ON "AccountGrant"("accountId", "granteeSpaceId");
CREATE INDEX "FinancialDocument_spaceId_createdAt_idx" ON "FinancialDocument"("spaceId", "createdAt");
CREATE INDEX "FinancialDocument_accountId_idx" ON "FinancialDocument"("accountId");
CREATE UNIQUE INDEX "SpaceSuccessionPlan_spaceId_key" ON "SpaceSuccessionPlan"("spaceId");
CREATE INDEX "SpaceSuccessor_userId_idx" ON "SpaceSuccessor"("userId");
CREATE UNIQUE INDEX "SpaceSuccessor_planId_email_key" ON "SpaceSuccessor"("planId", "email");
CREATE INDEX "SuccessionRequest_planId_status_idx" ON "SuccessionRequest"("planId", "status");
CREATE INDEX "SuccessionRequest_executeAfter_idx" ON "SuccessionRequest"("executeAfter");
CREATE UNIQUE INDEX "SuccessionApproval_requestId_userId_key" ON "SuccessionApproval"("requestId", "userId");
CREATE INDEX "AuditLog_spaceId_idx" ON "AuditLog"("spaceId");
CREATE INDEX "BankAccount_ownerSpaceId_idx" ON "BankAccount"("ownerSpaceId");
CREATE INDEX "BillOccurrence_spaceId_idx" ON "BillOccurrence"("spaceId");
CREATE UNIQUE INDEX "BillOccurrence_spaceId_sourceType_sourceId_dueDate_key" ON "BillOccurrence"("spaceId", "sourceType", "sourceId", "dueDate");
CREATE INDEX "Budget_spaceId_idx" ON "Budget"("spaceId");
CREATE INDEX "Category_spaceId_idx" ON "Category"("spaceId");
CREATE UNIQUE INDEX "Category_spaceId_name_key" ON "Category"("spaceId", "name");
CREATE INDEX "Envelope_spaceId_idx" ON "Envelope"("spaceId");
CREATE UNIQUE INDEX "Envelope_spaceId_monthYear_name_key" ON "Envelope"("spaceId", "monthYear", "name");
CREATE INDEX "Forecast_spaceId_idx" ON "Forecast"("spaceId");
CREATE INDEX "Goal_spaceId_idx" ON "Goal"("spaceId");
CREATE INDEX "MileageLog_spaceId_idx" ON "MileageLog"("spaceId");
CREATE INDEX "NetWorthSnapshot_spaceId_idx" ON "NetWorthSnapshot"("spaceId");
CREATE UNIQUE INDEX "NetWorthSnapshot_spaceId_capturedAt_key" ON "NetWorthSnapshot"("spaceId", "capturedAt");
CREATE INDEX "Order_spaceId_idx" ON "Order"("spaceId");
CREATE UNIQUE INDEX "Order_spaceId_source_externalId_key" ON "Order"("spaceId", "source", "externalId");
CREATE INDEX "Plan_spaceId_idx" ON "Plan"("spaceId");
CREATE INDEX "Recommendation_spaceId_idx" ON "Recommendation"("spaceId");
CREATE INDEX "Rule_spaceId_idx" ON "Rule"("spaceId");
CREATE INDEX "Scenario_spaceId_idx" ON "Scenario"("spaceId");
CREATE INDEX "Schedule_spaceId_idx" ON "Schedule"("spaceId");
CREATE INDEX "SpendingAlert_spaceId_idx" ON "SpendingAlert"("spaceId");
CREATE INDEX "Subscription_spaceId_idx" ON "Subscription"("spaceId");
CREATE UNIQUE INDEX "Subscription_spaceId_merchant_cadenceDays_amount_key" ON "Subscription"("spaceId", "merchant", "cadenceDays", "amount");
CREATE INDEX "TaxBucket_spaceId_idx" ON "TaxBucket"("spaceId");
CREATE INDEX "Tag_spaceId_idx" ON "Tag"("spaceId");
CREATE UNIQUE INDEX "Tag_spaceId_parentId_name_key" ON "Tag"("spaceId", "parentId", "name");
