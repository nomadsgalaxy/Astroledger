// Statement reconciliation — "does my cleared balance match the bank?"
//
// Model (Quicken/YNAB-style, sign convention: amount<0 outflow, amount>0 inflow):
//   • A transaction is `cleared` once the user confirms it appears on a bank
//     statement. Cleared balance = Σ amount over cleared rows.
//   • `reconciledAt` is stamped on cleared rows at LOCK time. Locked rows are
//     the immutable carry-forward; unlocked-cleared rows are the current
//     session's work.
//   • The user enters the statement's ending balance. Difference =
//     statementBalance − clearedBalance. When it's zero, the account ties out
//     and can be locked.
//   • For incomplete histories (imports that don't reach account-open), the
//     first reconcile won't tie out from transactions alone — the caller can
//     create a single balancing "Reconciliation adjustment" row for the
//     residual, which is exactly how Quicken seeds an opening balance.
//
// This module is read-only state derivation; mutations (clear toggles, lock,
// adjustment) happen in the route handlers so auth lives at the edge.

import { prisma } from './prisma';

export type ReconcileTxn = {
  id: string;
  date: Date;
  merchant: string | null;
  rawDescription: string | null;
  amount: number;
  cleared: boolean;
  locked: boolean; // reconciledAt != null
};

export type ReconcileState = {
  account: { id: string; name: string; balance: number | null; currency: string; reconciledAsOf: Date | null };
  reconciledBalance: number;    // Σ amount over locked rows
  clearedBalance: number;       // Σ amount over all cleared rows (locked + unlocked)
  clearedUnlockedSum: number;   // Σ amount over cleared-but-not-locked rows
  bookBalance: number;          // Σ amount over EVERY row (the account's full ledger)
  clearedCount: number;
  unlockedClearedCount: number;
  lockedCount: number;
  txns: ReconcileTxn[];         // most-recent window for toggling
  olderUnclearedCount: number;  // uncleared rows beyond the displayed window
};

const WINDOW = 500; // rows shown for toggling; sums below are computed over ALL rows

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function getReconcileState(accountId: string): Promise<ReconcileState | null> {
  const account = await prisma.bankAccount.findUnique({
    where: { id: accountId },
    select: { id: true, name: true, balance: true, currency: true, reconciledAsOf: true },
  });
  if (!account) return null;

  // Reconciliation matches against BANK-STATEMENT LINES, which correspond to the
  // parent charge — never the internal split children. A split keeps the parent
  // row in the ledger at its full bank amount AND adds child rows that sum to
  // it, so counting both double-counts. Scope every balance + the toggle window
  // to `parentTransactionId: null` (parents + unsplit rows, children excluded),
  // so a $100 charge split $60+$40 reconciles as the single $100 bank line.
  const ledger = { accountId, parentTransactionId: null };
  // Sums over the FULL ledger via aggregates (independent of the display window).
  const [allAgg, clearedAgg, lockedAgg, totalCount] = await Promise.all([
    prisma.transaction.aggregate({ where: ledger, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { ...ledger, cleared: true }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { ...ledger, reconciledAt: { not: null } }, _sum: { amount: true } }),
    prisma.transaction.count({ where: ledger }),
  ]);
  const [clearedCount, lockedCount] = await Promise.all([
    prisma.transaction.count({ where: { ...ledger, cleared: true } }),
    prisma.transaction.count({ where: { ...ledger, reconciledAt: { not: null } } }),
  ]);

  const bookBalance = round2(allAgg._sum.amount ?? 0);
  const clearedBalance = round2(clearedAgg._sum.amount ?? 0);
  const reconciledBalance = round2(lockedAgg._sum.amount ?? 0);
  const clearedUnlockedSum = round2(clearedBalance - reconciledBalance);

  const rows = await prisma.transaction.findMany({
    where: ledger,
    orderBy: { date: 'desc' },
    take: WINDOW,
    select: { id: true, date: true, merchant: true, rawDescription: true, amount: true, cleared: true, reconciledAt: true },
  });
  const txns: ReconcileTxn[] = rows.map(r => ({
    id: r.id, date: r.date, merchant: r.merchant, rawDescription: r.rawDescription,
    amount: r.amount, cleared: r.cleared, locked: r.reconciledAt != null,
  }));

  // Uncleared rows older than the window aren't shown but still matter — surface
  // a count so the user knows the list isn't the whole story.
  const shownIds = new Set(rows.map(r => r.id));
  const olderUncleared = totalCount > WINDOW
    ? await prisma.transaction.count({ where: { ...ledger, cleared: false, id: { notIn: [...shownIds] } } })
    : 0;

  return {
    account,
    reconciledBalance,
    clearedBalance,
    clearedUnlockedSum,
    bookBalance,
    clearedCount,
    unlockedClearedCount: clearedCount - lockedCount,
    lockedCount,
    txns,
    olderUnclearedCount: olderUncleared,
  };
}

// Compute the difference for a candidate statement balance. Positive means the
// statement is higher than what's cleared (missing inflows / extra outflows
// cleared); negative the reverse. Zero (within a cent) ties out.
export function reconcileDifference(statementBalance: number, clearedBalance: number): number {
  return round2(statementBalance - clearedBalance);
}

export function tiesOut(diff: number): boolean {
  return Math.abs(diff) < 0.005;
}
