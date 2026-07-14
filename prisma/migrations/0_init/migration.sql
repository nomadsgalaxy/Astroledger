-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "plaidItemId" TEXT,
    "accessToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" DATETIME,
    "lastSyncStatus" TEXT DEFAULT 'never',
    "lastSyncError" TEXT
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "institutionId" TEXT NOT NULL,
    "plaidAccountId" TEXT,
    "name" TEXT NOT NULL,
    "officialName" TEXT,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "kind" TEXT,
    "mask" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "balance" REAL,
    "balanceAsOf" DATETIME,
    "reconciledAsOf" DATETIME,
    "apr" REAL,
    "minimumPayment" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankAccount_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "parent" TEXT,
    "color" TEXT
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uuid" TEXT,
    "accountId" TEXT NOT NULL,
    "plaidTxId" TEXT,
    "hash" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "rawDescription" TEXT NOT NULL,
    "merchant" TEXT,
    "categoryId" TEXT,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "cleared" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" DATETIME,
    "isTransfer" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isAnticipated" BOOLEAN NOT NULL DEFAULT false,
    "mergedFromAnticipated" TEXT,
    "pairingDismissed" BOOLEAN NOT NULL DEFAULT false,
    "parentTransactionId" TEXT,
    "isSplit" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionId" TEXT,
    "transferGroupId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "baseAmount" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_parentTransactionId_fkey" FOREIGN KEY ("parentTransactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "parsedAmount" REAL,
    "parsedMerchant" TEXT,
    "parsedDate" DATETIME,
    "ocrText" TEXT,
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Receipt_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchant" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "cadence" TEXT NOT NULL,
    "cadenceDays" INTEGER NOT NULL,
    "firstSeen" DATETIME NOT NULL,
    "lastSeen" DATETIME NOT NULL,
    "nextEstimate" DATETIME,
    "confidence" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "categoryId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT,
    "scope" TEXT NOT NULL,
    "merchant" TEXT,
    "monthly" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "merchant" TEXT NOT NULL,
    "orderDate" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "items" TEXT,
    "url" TEXT,
    "raw" TEXT,
    "transactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Order_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetAmount" REAL NOT NULL,
    "currentAmount" REAL NOT NULL DEFAULT 0,
    "deadline" DATETIME,
    "accountId" TEXT,
    "categoryId" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "monthlySavings" REAL,
    "refType" TEXT,
    "refId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" DATETIME
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uuid" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'secondary',
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Tag_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Tag" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Forecast" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT,
    "flow" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "horizonMonths" INTEGER NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedFrom" DATETIME NOT NULL,
    "meta" TEXT
);

-- CreateTable
CREATE TABLE "ForecastPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "forecastId" TEXT NOT NULL,
    "month" DATETIME NOT NULL,
    "point" REAL NOT NULL,
    "low" REAL NOT NULL,
    "high" REAL NOT NULL,
    "contribRecurring" REAL,
    "contribVariable" REAL,
    "contribManual" REAL,
    CONSTRAINT "ForecastPoint_forecastId_fkey" FOREIGN KEY ("forecastId") REFERENCES "Forecast" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL,
    "supersededBy" TEXT,
    "supersededAt" DATETIME,
    "activatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "PlanLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT,
    "month" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "flow" TEXT NOT NULL,
    "sourceMethod" TEXT,
    "notes" TEXT,
    CONSTRAINT "PlanLine_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "emailVerified" DATETIME,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Authenticator" (
    "credentialID" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "credentialPublicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "credentialDeviceType" TEXT NOT NULL,
    "credentialBackedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    CONSTRAINT "Authenticator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "matchType" TEXT NOT NULL DEFAULT 'substring',
    "matchField" TEXT NOT NULL DEFAULT 'rawDescription',
    "matchValue" TEXT NOT NULL,
    "caseInsensitive" BOOLEAN NOT NULL DEFAULT true,
    "accountIds" TEXT,
    "minAmount" REAL,
    "maxAmount" REAL,
    "applyTagIds" TEXT,
    "applyCategory" TEXT,
    "applyIsTransfer" BOOLEAN,
    "applyMerchant" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NetWorthSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "capturedAt" DATETIME NOT NULL,
    "assets" REAL NOT NULL,
    "liabilities" REAL NOT NULL,
    "net" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MileageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "miles" REAL NOT NULL,
    "purpose" TEXT NOT NULL,
    "ratePerMile" REAL NOT NULL,
    "tagId" TEXT,
    "categoryId" TEXT,
    "notes" TEXT,
    "transactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TaxBucket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleLine" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "matchers" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SpendingAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL DEFAULT 'tag',
    "tagId" TEXT,
    "categoryId" TEXT,
    "monthlyCap" REAL NOT NULL,
    "warnPct" REAL NOT NULL DEFAULT 0.8,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Envelope" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthYear" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "allocated" REAL NOT NULL,
    "rollover" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT NOT NULL DEFAULT 'tag',
    "tagId" TEXT,
    "categoryId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "surface" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "isWrite" BOOLEAN NOT NULL DEFAULT false,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "description" TEXT,
    "units" REAL NOT NULL,
    "costBasis" REAL,
    "marketValue" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "lastPriceAsOf" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'simplefin',
    "securityId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Holding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Holding_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Security" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SecurityPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "price" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'qif',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityPrice_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvestmentTxn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uuid" TEXT,
    "accountId" TEXT NOT NULL,
    "securityId" TEXT,
    "date" DATETIME NOT NULL,
    "action" TEXT NOT NULL,
    "rawAction" TEXT NOT NULL,
    "units" REAL,
    "price" REAL,
    "amount" REAL,
    "commission" REAL,
    "splitRatio" REAL,
    "memo" TEXT,
    "transferAccountRef" TEXT,
    "transferGroupId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'qif',
    "hash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvestmentTxn_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvestmentTxn_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_SubscriptionTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_SubscriptionTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Subscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_SubscriptionTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_TransactionTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_TransactionTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_TransactionTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Institution_plaidItemId_key" ON "Institution"("plaidItemId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_plaidAccountId_key" ON "BankAccount"("plaidAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_uuid_key" ON "Transaction"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_plaidTxId_key" ON "Transaction"("plaidTxId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_hash_key" ON "Transaction"("hash");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_merchant_idx" ON "Transaction"("merchant");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_idx" ON "Transaction"("categoryId");

-- CreateIndex
CREATE INDEX "Transaction_transferGroupId_idx" ON "Transaction"("transferGroupId");

-- CreateIndex
CREATE INDEX "Transaction_isAnticipated_idx" ON "Transaction"("isAnticipated");

-- CreateIndex
CREATE INDEX "Receipt_transactionId_idx" ON "Receipt"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_merchant_cadenceDays_amount_key" ON "Subscription"("merchant", "cadenceDays", "amount");

-- CreateIndex
CREATE INDEX "Order_orderDate_idx" ON "Order"("orderDate");

-- CreateIndex
CREATE INDEX "Order_merchant_idx" ON "Order"("merchant");

-- CreateIndex
CREATE INDEX "Order_amount_idx" ON "Order"("amount");

-- CreateIndex
CREATE UNIQUE INDEX "Order_source_externalId_key" ON "Order"("source", "externalId");

-- CreateIndex
CREATE INDEX "Recommendation_status_dismissedAt_idx" ON "Recommendation"("status", "dismissedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_uuid_key" ON "Tag"("uuid");

-- CreateIndex
CREATE INDEX "Tag_parentId_idx" ON "Tag"("parentId");

-- CreateIndex
CREATE INDEX "Tag_kind_idx" ON "Tag"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_parentId_name_key" ON "Tag"("parentId", "name");

-- CreateIndex
CREATE INDEX "Forecast_scope_scopeKey_generatedAt_idx" ON "Forecast"("scope", "scopeKey", "generatedAt");

-- CreateIndex
CREATE INDEX "ForecastPoint_forecastId_month_idx" ON "ForecastPoint"("forecastId", "month");

-- CreateIndex
CREATE INDEX "Plan_status_periodStart_idx" ON "Plan"("status", "periodStart");

-- CreateIndex
CREATE INDEX "PlanLine_planId_month_idx" ON "PlanLine"("planId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PlanLine_planId_scope_scopeKey_month_flow_key" ON "PlanLine"("planId", "scope", "scopeKey", "month", "flow");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Rule_enabled_sortOrder_idx" ON "Rule"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX "NetWorthSnapshot_capturedAt_idx" ON "NetWorthSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NetWorthSnapshot_capturedAt_key" ON "NetWorthSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "MileageLog_date_idx" ON "MileageLog"("date");

-- CreateIndex
CREATE INDEX "SpendingAlert_enabled_idx" ON "SpendingAlert"("enabled");

-- CreateIndex
CREATE INDEX "Envelope_monthYear_idx" ON "Envelope"("monthYear");

-- CreateIndex
CREATE UNIQUE INDEX "Envelope_monthYear_name_key" ON "Envelope"("monthYear", "name");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_surface_idx" ON "AuditLog"("surface");

-- CreateIndex
CREATE INDEX "FxRate_quote_date_idx" ON "FxRate"("quote", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_date_quote_key" ON "FxRate"("date", "quote");

-- CreateIndex
CREATE INDEX "Holding_accountId_idx" ON "Holding"("accountId");

-- CreateIndex
CREATE INDEX "Holding_securityId_idx" ON "Holding"("securityId");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_accountId_symbol_key" ON "Holding"("accountId", "symbol");

-- CreateIndex
CREATE INDEX "Security_symbol_idx" ON "Security"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Security_symbol_key" ON "Security"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Security_name_key" ON "Security"("name");

-- CreateIndex
CREATE INDEX "SecurityPrice_securityId_date_idx" ON "SecurityPrice"("securityId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityPrice_securityId_date_key" ON "SecurityPrice"("securityId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentTxn_uuid_key" ON "InvestmentTxn"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentTxn_hash_key" ON "InvestmentTxn"("hash");

-- CreateIndex
CREATE INDEX "InvestmentTxn_accountId_date_idx" ON "InvestmentTxn"("accountId", "date");

-- CreateIndex
CREATE INDEX "InvestmentTxn_securityId_date_idx" ON "InvestmentTxn"("securityId", "date");

-- CreateIndex
CREATE INDEX "InvestmentTxn_transferGroupId_idx" ON "InvestmentTxn"("transferGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "_SubscriptionTags_AB_unique" ON "_SubscriptionTags"("A", "B");

-- CreateIndex
CREATE INDEX "_SubscriptionTags_B_index" ON "_SubscriptionTags"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_TransactionTags_AB_unique" ON "_TransactionTags"("A", "B");

-- CreateIndex
CREATE INDEX "_TransactionTags_B_index" ON "_TransactionTags"("B");

