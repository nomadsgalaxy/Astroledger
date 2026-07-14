-- Durable bill occurrence lifecycle.
ALTER TABLE "Subscription" ADD COLUMN "amountMode" TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE "Subscription" ADD COLUMN "autopay" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Schedule" ADD COLUMN "amountMode" TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE "Schedule" ADD COLUMN "autopay" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BillOccurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "expectedAmount" REAL NOT NULL,
    "amountMode" TEXT NOT NULL DEFAULT 'fixed',
    "autopay" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "transactionId" TEXT,
    "paidAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillOccurrence_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BillOccurrence_sourceType_sourceId_dueDate_key" ON "BillOccurrence"("sourceType", "sourceId", "dueDate");
CREATE INDEX "BillOccurrence_status_dueDate_idx" ON "BillOccurrence"("status", "dueDate");
CREATE INDEX "BillOccurrence_transactionId_idx" ON "BillOccurrence"("transactionId");

-- Email-bound household invitations. The OAuth provider verifies possession of
-- the address; successful sign-in converts the invite to a membership.
CREATE TABLE "HouseholdInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "invitedById" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HouseholdInvite_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "HouseholdInvite_householdId_email_key" ON "HouseholdInvite"("householdId", "email");
CREATE INDEX "HouseholdInvite_email_expiresAt_idx" ON "HouseholdInvite"("email", "expiresAt");
