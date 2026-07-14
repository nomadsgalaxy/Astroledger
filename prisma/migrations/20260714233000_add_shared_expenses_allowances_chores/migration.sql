-- Household money workflows: shared expenses with settlement, recurring
-- allowances with guardian approval, and reward chores. Additive only.

-- CreateTable
CREATE TABLE "SharedExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT,
    "transactionId" TEXT NOT NULL,
    "paidById" TEXT NOT NULL,
    "splitMode" TEXT NOT NULL DEFAULT 'equal',
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ExpenseShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expenseId" TEXT NOT NULL,
    "userId" TEXT,
    "label" TEXT,
    "amount" REAL NOT NULL,
    "percentage" REAL,
    "settledAt" DATETIME,
    "settledById" TEXT,
    "settlementTransactionId" TEXT,
    CONSTRAINT "ExpenseShare_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "SharedExpense" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExpenseShare_participant_required" CHECK ("userId" IS NOT NULL OR "label" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "AllowanceRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT,
    "name" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "cadenceDays" INTEGER NOT NULL,
    "nextDate" DATETIME NOT NULL,
    "accountId" TEXT NOT NULL,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AllowancePayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT,
    "ruleId" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedById" TEXT,
    "transactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AllowancePayout_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AllowanceRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChoreTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT,
    "name" TEXT NOT NULL,
    "reward" REAL NOT NULL,
    "assigneeUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "completedAt" DATETIME,
    "approvedById" TEXT,
    "transactionId" TEXT,
    "accountId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedExpense_transactionId_key" ON "SharedExpense"("transactionId");

-- CreateIndex
CREATE INDEX "SharedExpense_spaceId_status_idx" ON "SharedExpense"("spaceId", "status");

-- CreateIndex
CREATE INDEX "ExpenseShare_userId_idx" ON "ExpenseShare"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseShare_expenseId_userId_key" ON "ExpenseShare"("expenseId", "userId");

-- CreateIndex
CREATE INDEX "AllowanceRule_spaceId_active_idx" ON "AllowanceRule"("spaceId", "active");

-- CreateIndex
CREATE INDEX "AllowancePayout_spaceId_status_idx" ON "AllowancePayout"("spaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AllowancePayout_ruleId_dueDate_key" ON "AllowancePayout"("ruleId", "dueDate");

-- CreateIndex
CREATE INDEX "ChoreTask_spaceId_status_idx" ON "ChoreTask"("spaceId", "status");

-- CreateIndex
CREATE INDEX "ChoreTask_assigneeUserId_idx" ON "ChoreTask"("assigneeUserId");

