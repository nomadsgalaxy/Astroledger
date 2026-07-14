// Shared household expenses: one real bank charge, split into shares that
// participants owe the payer, settled by linking reimbursements or marking
// paid. The transaction itself is never duplicated; reimbursements linked at
// settlement are flagged isTransfer so rollups don't count them as income.
//
// Services take the resolved RequestAccess explicitly (routes pass
// getRequestFinancialAccess()); the request-scoped Prisma guard independently
// re-scopes every query, so these checks are authorization semantics on top
// of, not instead of, tenant isolation.
import { prisma } from './prisma';
import type { RequestAccess } from './financialAccess';
import { notifyUser, recordSpaceEvent } from './spaceEvents';

export class SharedExpenseError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type ShareInput = { userId?: string; label?: string; amount?: number; percentage?: number };

const MODES = new Set(['equal', 'percentage', 'fixed', 'custom']);
const round2 = (value: number) => Math.round(value * 100) / 100;

function computeShareAmounts(mode: string, base: number, shares: ShareInput[]): number[] {
  if (mode === 'equal') {
    const even = Math.floor((base / shares.length) * 100) / 100;
    const amounts = shares.map(() => even);
    amounts[amounts.length - 1] = round2(base - even * (shares.length - 1));
    return amounts;
  }
  if (mode === 'percentage') {
    const total = shares.reduce((sum, share) => sum + (share.percentage ?? 0), 0);
    if (Math.abs(total - 100) > 0.5) throw new SharedExpenseError('Percentages must add up to 100');
    const amounts = shares.map(share => round2(base * (share.percentage ?? 0) / 100));
    const drift = round2(base - amounts.reduce((sum, amount) => sum + amount, 0));
    amounts[amounts.length - 1] = round2(amounts[amounts.length - 1] + drift);
    return amounts;
  }
  // fixed | custom: caller supplies every amount and they must cover the charge.
  const amounts = shares.map(share => round2(share.amount ?? NaN));
  if (amounts.some(amount => !isFinite(amount) || amount < 0)) throw new SharedExpenseError('Every share needs a non-negative amount');
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (Math.abs(total - base) > 0.02) {
    throw new SharedExpenseError(`Shares add up to ${total.toFixed(2)} but the charge is ${base.toFixed(2)}`);
  }
  return amounts;
}

export async function createSharedExpense(access: RequestAccess, input: {
  transactionId: string; splitMode?: string; shares: ShareInput[]; notes?: string; paidById?: string;
}) {
  const mode = MODES.has(input.splitMode ?? '') ? input.splitMode! : 'equal';
  const transaction = await prisma.transaction.findUnique({
    where: { id: input.transactionId },
    select: { id: true, accountId: true, amount: true, merchant: true, rawDescription: true, isSplit: true },
  });
  if (!transaction) throw new SharedExpenseError('Transaction not found', 404);
  if (!access.manageAccountIds.includes(transaction.accountId)) {
    throw new SharedExpenseError('Manage access to the account is required to split its charges', 403);
  }
  if (transaction.amount >= 0) throw new SharedExpenseError('Only outflows can be split as shared expenses');
  const base = round2(Math.abs(transaction.amount));

  const shares = (input.shares ?? []).slice(0, 20);
  if (shares.length < 1) throw new SharedExpenseError('Add at least one participant');
  const memberIds = new Set((await prisma.financialSpaceMember.findMany({
    where: { spaceId: access.activeSpaceId }, select: { userId: true },
  })).map(member => member.userId));
  const seenUsers = new Set<string>();
  for (const share of shares) {
    if (!!share.userId === !!share.label?.trim()) throw new SharedExpenseError('Each share needs exactly one person or name');
    if (share.userId) {
      if (!memberIds.has(share.userId)) throw new SharedExpenseError('Participants must be members of this space', 403);
      if (seenUsers.has(share.userId)) throw new SharedExpenseError('Each person can appear only once');
      seenUsers.add(share.userId);
    }
  }
  const paidById = input.paidById ?? access.userId;
  if (!memberIds.has(paidById)) throw new SharedExpenseError('The payer must be a member of this space', 403);

  const amounts = computeShareAmounts(mode, base, shares);
  const now = new Date();
  const expense = await prisma.sharedExpense.create({
    data: {
      transactionId: transaction.id,
      paidById,
      splitMode: mode,
      notes: input.notes?.trim().slice(0, 500) || null,
      shares: {
        create: shares.map((share, index) => ({
          userId: share.userId ?? null,
          label: share.label?.trim().slice(0, 120) || null,
          amount: amounts[index],
          percentage: mode === 'percentage' ? share.percentage ?? null : null,
          // The payer's own slice is not owed to anyone.
          ...(share.userId === paidById ? { settledAt: now, settledById: paidById } : {}),
        })),
      },
    },
    include: { shares: true },
  });
  await recordSpaceEvent({
    spaceId: access.activeSpaceId, actorId: access.userId, action: 'split.create', targetType: 'expense', targetId: expense.id,
    summary: `Split "${transaction.merchant ?? transaction.rawDescription}" (${base.toFixed(2)}) ${mode} across ${shares.length} participant${shares.length === 1 ? '' : 's'}`,
    after: { transactionId: transaction.id, splitMode: mode, shareCount: shares.length },
  });
  for (const share of expense.shares) {
    if (share.userId && share.userId !== access.userId && !share.settledAt) {
      await notifyUser({
        spaceId: access.activeSpaceId, userId: share.userId, kind: 'split',
        title: `You owe ${share.amount.toFixed(2)} for "${transaction.merchant ?? transaction.rawDescription}"`,
        linkPath: '/spaces',
      });
    }
  }
  return expense;
}

async function loadShare(access: RequestAccess, shareId: string) {
  const share = await prisma.expenseShare.findFirst({ where: { id: shareId }, include: { expense: true } });
  if (!share) throw new SharedExpenseError('Share not found', 404);
  const involved = access.userId === share.expense.paidById || access.userId === share.userId;
  if (!involved && !access.canAdminSpace) throw new SharedExpenseError('Only the payer, the participant, or a space owner can do that', 403);
  return share;
}

async function refreshExpenseStatus(expenseId: string) {
  const open = await prisma.expenseShare.count({ where: { expenseId, settledAt: null } });
  await prisma.sharedExpense.update({ where: { id: expenseId }, data: { status: open ? 'open' : 'settled' } });
}

export async function settleExpenseShare(access: RequestAccess, shareId: string, input: { settlementTransactionId?: string } = {}) {
  const share = await loadShare(access, shareId);
  if (share.settledAt) throw new SharedExpenseError('This share is already settled', 409);
  let settlementTransactionId: string | null = null;
  if (input.settlementTransactionId) {
    const reimbursement = await prisma.transaction.findUnique({
      where: { id: input.settlementTransactionId }, select: { id: true, accountId: true },
    });
    if (!reimbursement) throw new SharedExpenseError('Reimbursement transaction not found', 404);
    if (!access.manageAccountIds.includes(reimbursement.accountId)) {
      throw new SharedExpenseError('Manage access to the reimbursement account is required', 403);
    }
    // A reimbursement is money coming back, not income — exclude it from rollups.
    await prisma.transaction.update({ where: { id: reimbursement.id }, data: { isTransfer: true } });
    settlementTransactionId = reimbursement.id;
  }
  await prisma.expenseShare.update({
    where: { id: shareId },
    data: { settledAt: new Date(), settledById: access.userId, settlementTransactionId },
  });
  await refreshExpenseStatus(share.expenseId);
  await recordSpaceEvent({
    spaceId: access.activeSpaceId, actorId: access.userId, action: 'split.settle', targetType: 'expense', targetId: share.expenseId,
    summary: `Settled a ${share.amount.toFixed(2)} share${settlementTransactionId ? ' with a linked reimbursement' : ''}`,
    after: { shareId, settlementTransactionId },
  });
  const counterparty = access.userId === share.expense.paidById ? share.userId : share.expense.paidById;
  if (counterparty && counterparty !== access.userId) {
    await notifyUser({
      spaceId: access.activeSpaceId, userId: counterparty, kind: 'split',
      title: `A ${share.amount.toFixed(2)} shared-expense share was settled`, linkPath: '/spaces',
    });
  }
}

export async function reopenExpenseShare(access: RequestAccess, shareId: string) {
  const share = await loadShare(access, shareId);
  if (!share.settledAt) throw new SharedExpenseError('This share is not settled', 409);
  // ponytail: a previously linked reimbursement keeps its isTransfer flag; the
  // user can flip it back in the transfer review screen if it was wrong.
  await prisma.expenseShare.update({
    where: { id: shareId }, data: { settledAt: null, settledById: null, settlementTransactionId: null },
  });
  await refreshExpenseStatus(share.expenseId);
  await recordSpaceEvent({
    spaceId: access.activeSpaceId, actorId: access.userId, action: 'split.reopen', targetType: 'expense', targetId: share.expenseId,
    summary: `Reopened a ${share.amount.toFixed(2)} share`, after: { shareId },
  });
}

export async function deleteSharedExpense(access: RequestAccess, expenseId: string) {
  const expense = await prisma.sharedExpense.findFirst({ where: { id: expenseId } });
  if (!expense) throw new SharedExpenseError('Shared expense not found', 404);
  if (expense.paidById !== access.userId && !access.canAdminSpace) {
    throw new SharedExpenseError('Only the payer or a space owner can remove a split', 403);
  }
  await prisma.sharedExpense.delete({ where: { id: expenseId } });
  await recordSpaceEvent({
    spaceId: access.activeSpaceId, actorId: access.userId, action: 'split.delete', targetType: 'expense', targetId: expenseId,
    summary: 'Removed a shared-expense split',
  });
}

export async function listSharedExpenses(access: RequestAccess) {
  const expenses = await prisma.sharedExpense.findMany({
    include: { shares: true }, orderBy: { createdAt: 'desc' }, take: 100,
  });
  const transactionIds = expenses.map(expense => expense.transactionId);
  const transactions = transactionIds.length ? await prisma.transaction.findMany({
    where: { id: { in: transactionIds } },
    select: { id: true, date: true, amount: true, merchant: true, rawDescription: true },
  }) : [];
  const txById = new Map(transactions.map(tx => [tx.id, tx]));
  const userIds = [...new Set(expenses.flatMap(expense => [expense.paidById, ...expense.shares.map(share => share.userId)]).filter(Boolean))] as string[];
  const users = userIds.length ? await prisma.user.findMany({
    where: { id: { in: userIds } }, select: { id: true, name: true, email: true },
  }) : [];

  let youOwe = 0, owedToYou = 0;
  for (const expense of expenses) {
    for (const share of expense.shares) {
      if (share.settledAt) continue;
      if (share.userId === access.userId && expense.paidById !== access.userId) youOwe += share.amount;
      if (expense.paidById === access.userId && share.userId !== access.userId) owedToYou += share.amount;
    }
  }
  return {
    expenses: expenses.map(expense => ({ ...expense, transaction: txById.get(expense.transactionId) ?? null })),
    users,
    summary: { youOwe: round2(youOwe), owedToYou: round2(owedToYou) },
  };
}

/** Recent unsplit outflows that can become a shared expense. */
export async function listSplitCandidates(access: RequestAccess) {
  if (!access.manageAccountIds.length) return [];
  // SharedExpense.transactionId is a scalar boundary (no Prisma relation), so
  // exclude already-split charges by id list instead of a relation filter.
  const taken = (await prisma.sharedExpense.findMany({ select: { transactionId: true } })).map(expense => expense.transactionId);
  return prisma.transaction.findMany({
    where: {
      accountId: { in: access.manageAccountIds },
      amount: { lt: 0 }, isTransfer: false, parentTransactionId: null,
      date: { gte: new Date(Date.now() - 90 * 86_400_000) },
      ...(taken.length ? { id: { notIn: taken } } : {}),
    },
    select: { id: true, date: true, amount: true, merchant: true, rawDescription: true },
    orderBy: { date: 'desc' }, take: 100,
  });
}

/** Recent inflows that can be linked as reimbursements at settlement. */
export async function listSettleCandidates(access: RequestAccess) {
  if (!access.manageAccountIds.length) return [];
  return prisma.transaction.findMany({
    where: {
      accountId: { in: access.manageAccountIds },
      amount: { gt: 0 }, isTransfer: false, parentTransactionId: null,
      date: { gte: new Date(Date.now() - 90 * 86_400_000) },
    },
    select: { id: true, date: true, amount: true, merchant: true, rawDescription: true },
    orderBy: { date: 'desc' }, take: 50,
  });
}
