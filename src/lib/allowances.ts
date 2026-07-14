// Allowances and reward chores for stewarded (dependent) spaces.
//
// An AllowanceRule materializes AllowancePayout rows as they come due; a
// guardian approval (or autoApprove) turns a payout into a real Transaction
// in the dependent's account. Chores follow the same shape: the dependent
// marks a chore done, a guardian approves, the reward pays out. Money only
// ever moves through Transaction rows the Prisma guard has scoped.
import { prisma } from './prisma';
import type { RequestAccess } from './financialAccess';
import { notifySpaceMembers, notifyUser, recordSpaceEvent } from './spaceEvents';

export class AllowanceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const MAX_CATCH_UP = 6; // payouts materialized per rule per visit; older misses are skipped
const round2 = (value: number) => Math.round(value * 100) / 100;

function requireManage(access: RequestAccess) {
  if (!access.canCreate) throw new AllowanceError('Guardian or manager access is required', 403);
}

async function payInto(access: RequestAccess, accountId: string, amount: number, description: string, hash: string, date: Date) {
  const transaction = await prisma.transaction.create({
    data: {
      accountId, date, amount: round2(amount),
      rawDescription: description, merchant: 'Allowance', hash,
    },
    select: { id: true },
  });
  // Keep the wallet's displayed balance in step with its ledger.
  const account = await prisma.bankAccount.findUnique({ where: { id: accountId }, select: { balance: true } });
  await prisma.bankAccount.update({
    where: { id: accountId },
    data: { balance: round2((account?.balance ?? 0) + amount), balanceAsOf: date },
  });
  return transaction.id;
}

export async function upsertAllowanceRule(access: RequestAccess, input: {
  id?: string; name: string; amount: number; cadenceDays: number; nextDate: string;
  accountId: string; autoApprove?: boolean; active?: boolean; notes?: string;
}) {
  requireManage(access);
  const name = input.name?.trim().slice(0, 120);
  if (!name) throw new AllowanceError('A name is required');
  const amount = round2(Number(input.amount));
  if (!isFinite(amount) || amount <= 0) throw new AllowanceError('The allowance amount must be positive');
  const cadenceDays = Math.max(1, Math.min(Math.round(Number(input.cadenceDays) || 7), 366));
  const nextDate = new Date(input.nextDate);
  if (isNaN(+nextDate)) throw new AllowanceError('Choose a valid first payout date');
  if (!access.manageAccountIds.includes(input.accountId)) {
    throw new AllowanceError('Choose an account in this space for payouts', 403);
  }
  const data = {
    name, amount, cadenceDays, nextDate, accountId: input.accountId,
    autoApprove: !!input.autoApprove, active: input.active !== false,
    notes: input.notes?.trim().slice(0, 500) || null,
  };
  const rule = input.id
    ? await prisma.allowanceRule.update({ where: { id: input.id }, data })
    : await prisma.allowanceRule.create({ data });
  await recordSpaceEvent({
    spaceId: access.activeSpaceId, actorId: access.userId, action: 'allowance.rule.save', targetType: 'allowance', targetId: rule.id,
    summary: `${input.id ? 'Updated' : 'Created'} allowance "${name}" (${amount.toFixed(2)} every ${cadenceDays}d${data.autoApprove ? ', auto-approve' : ''})`,
    after: data,
  });
  return rule;
}

export async function deleteAllowanceRule(access: RequestAccess, ruleId: string) {
  requireManage(access);
  const rule = await prisma.allowanceRule.findFirst({ where: { id: ruleId } });
  if (!rule) throw new AllowanceError('Allowance not found', 404);
  await prisma.allowanceRule.delete({ where: { id: ruleId } });
  await recordSpaceEvent({
    spaceId: access.activeSpaceId, actorId: access.userId, action: 'allowance.rule.delete', targetType: 'allowance', targetId: ruleId,
    summary: `Removed allowance "${rule.name}"`, before: { name: rule.name, amount: rule.amount },
  });
}

async function payPayout(access: RequestAccess, payout: { id: string; amount: number; dueDate: Date }, rule: { id: string; name: string; accountId: string }, beneficiaryUserId?: string | null) {
  const transactionId = await payInto(
    access, rule.accountId, payout.amount, `Allowance: ${rule.name}`, `allowance:${payout.id}`, payout.dueDate,
  );
  await prisma.allowancePayout.update({
    where: { id: payout.id },
    data: { status: 'paid', approvedById: access.userId, transactionId },
  });
  await recordSpaceEvent({
    spaceId: access.activeSpaceId, actorId: access.userId, action: 'allowance.pay', targetType: 'allowance', targetId: payout.id,
    summary: `Paid ${payout.amount.toFixed(2)} allowance "${rule.name}"`, after: { transactionId },
  });
  if (beneficiaryUserId && beneficiaryUserId !== access.userId) {
    await notifyUser({
      spaceId: access.activeSpaceId, userId: beneficiaryUserId, kind: 'allowance',
      title: `Your ${payout.amount.toFixed(2)} allowance arrived`, linkPath: '/spaces',
    });
  }
}

/** Materialize due payouts for the active space. Auto-approve rules pay
 * immediately; others wait for a guardian decision. Manage-capable only —
 * a dependent's visit never creates or moves money. */
export async function processDueAllowances(access: RequestAccess): Promise<number> {
  if (!access.canCreate) return 0;
  const space = await prisma.financialSpace.findUnique({ where: { id: access.activeSpaceId }, select: { beneficiaryUserId: true } });
  const now = new Date();
  const rules = await prisma.allowanceRule.findMany({ where: { active: true, nextDate: { lte: now } } });
  let materialized = 0;
  for (const rule of rules) {
    let cursor = new Date(rule.nextDate);
    let created = 0;
    while (cursor <= now) {
      if (created < MAX_CATCH_UP) {
        const payout = await prisma.allowancePayout.upsert({
          where: { ruleId_dueDate: { ruleId: rule.id, dueDate: cursor } },
          create: { ruleId: rule.id, dueDate: cursor, amount: rule.amount },
          update: {},
        });
        if (payout.status === 'pending' && rule.autoApprove && !payout.transactionId) {
          await payPayout(access, payout, rule, space?.beneficiaryUserId);
        }
        created += 1;
        materialized += 1;
      }
      cursor = new Date(cursor.getTime() + rule.cadenceDays * 86_400_000);
    }
    await prisma.allowanceRule.update({ where: { id: rule.id }, data: { nextDate: cursor } });
  }
  return materialized;
}

export async function decideAllowancePayout(access: RequestAccess, payoutId: string, decision: 'approve' | 'reject') {
  requireManage(access);
  const payout = await prisma.allowancePayout.findFirst({ where: { id: payoutId }, include: { rule: true } });
  if (!payout || payout.status !== 'pending') throw new AllowanceError('Pending payout not found', 404);
  const space = await prisma.financialSpace.findUnique({ where: { id: access.activeSpaceId }, select: { beneficiaryUserId: true } });
  if (decision === 'approve') {
    await payPayout(access, payout, payout.rule, space?.beneficiaryUserId);
    return;
  }
  await prisma.allowancePayout.update({ where: { id: payoutId }, data: { status: 'rejected', approvedById: access.userId } });
  await recordSpaceEvent({
    spaceId: access.activeSpaceId, actorId: access.userId, action: 'allowance.reject', targetType: 'allowance', targetId: payoutId,
    summary: `Skipped the ${payout.amount.toFixed(2)} allowance "${payout.rule.name}" due ${payout.dueDate.toISOString().slice(0, 10)}`,
  });
}

export async function createChore(access: RequestAccess, input: {
  name: string; reward: number; assigneeUserId?: string; accountId?: string; notes?: string;
}) {
  requireManage(access);
  const name = input.name?.trim().slice(0, 160);
  if (!name) throw new AllowanceError('A chore needs a name');
  const reward = round2(Number(input.reward));
  if (!isFinite(reward) || reward <= 0) throw new AllowanceError('The reward must be positive');
  if (input.accountId && !access.manageAccountIds.includes(input.accountId)) {
    throw new AllowanceError('Choose a payout account in this space', 403);
  }
  const chore = await prisma.choreTask.create({
    data: {
      name, reward,
      assigneeUserId: input.assigneeUserId || null,
      accountId: input.accountId || null,
      notes: input.notes?.trim().slice(0, 500) || null,
    },
  });
  if (input.assigneeUserId && input.assigneeUserId !== access.userId) {
    await notifyUser({
      spaceId: access.activeSpaceId, userId: input.assigneeUserId, kind: 'chore',
      title: `New chore: "${name}" (earns ${reward.toFixed(2)})`, linkPath: '/spaces',
    });
  }
  return chore;
}

/** The dependent (or any member) marks a chore done; guardians then approve. */
export async function claimChore(access: RequestAccess, choreId: string) {
  const chore = await prisma.choreTask.findFirst({ where: { id: choreId } });
  if (!chore || chore.status !== 'open') throw new AllowanceError('Open chore not found', 404);
  if (chore.assigneeUserId && chore.assigneeUserId !== access.userId && !access.canCreate) {
    throw new AllowanceError('This chore is assigned to someone else', 403);
  }
  // The guard limits non-managers to their own chores and to status/completedAt.
  await prisma.choreTask.update({ where: { id: choreId }, data: { status: 'done_pending', completedAt: new Date() } });
  await notifySpaceMembers(access.activeSpaceId, {
    kind: 'chore', title: `"${chore.name}" was marked done — review to pay ${chore.reward.toFixed(2)}`, linkPath: '/spaces',
  }, { excludeUserId: access.userId, roles: ['owner', 'guardian', 'manager'] });
}

export async function decideChore(access: RequestAccess, choreId: string, decision: 'approve' | 'reject', accountId?: string) {
  requireManage(access);
  const chore = await prisma.choreTask.findFirst({ where: { id: choreId } });
  if (!chore || chore.status !== 'done_pending') throw new AllowanceError('Completed chore not found', 404);
  if (decision === 'reject') {
    // Back to open so the dependent can try again; nothing is paid.
    await prisma.choreTask.update({ where: { id: choreId }, data: { status: 'open', completedAt: null } });
    if (chore.assigneeUserId && chore.assigneeUserId !== access.userId) {
      await notifyUser({
        spaceId: access.activeSpaceId, userId: chore.assigneeUserId, kind: 'chore',
        title: `"${chore.name}" needs another look before it can be paid`, linkPath: '/spaces',
      });
    }
    return;
  }
  const payoutAccountId = accountId || chore.accountId;
  if (!payoutAccountId || !access.manageAccountIds.includes(payoutAccountId)) {
    throw new AllowanceError('Choose a payout account in this space', 400);
  }
  const transactionId = await payInto(
    access, payoutAccountId, chore.reward, `Chore reward: ${chore.name}`, `chore:${chore.id}`, new Date(),
  );
  await prisma.choreTask.update({
    where: { id: choreId },
    data: { status: 'paid', approvedById: access.userId, transactionId, accountId: payoutAccountId },
  });
  await recordSpaceEvent({
    spaceId: access.activeSpaceId, actorId: access.userId, action: 'chore.pay', targetType: 'chore', targetId: choreId,
    summary: `Paid ${chore.reward.toFixed(2)} for chore "${chore.name}"`, after: { transactionId },
  });
  if (chore.assigneeUserId && chore.assigneeUserId !== access.userId) {
    await notifyUser({
      spaceId: access.activeSpaceId, userId: chore.assigneeUserId, kind: 'chore',
      title: `You earned ${chore.reward.toFixed(2)} for "${chore.name}"`, linkPath: '/spaces',
    });
  }
}

export async function deleteChore(access: RequestAccess, choreId: string) {
  requireManage(access);
  const removed = await prisma.choreTask.deleteMany({ where: { id: choreId, status: { not: 'paid' } } });
  if (!removed.count) throw new AllowanceError('Only unpaid chores can be removed', 409);
}

/** Everything the /spaces allowance panel needs for the active space. */
export async function getAllowanceOverview(access: RequestAccess) {
  await processDueAllowances(access);
  const [space, rules, payouts, chores] = await Promise.all([
    prisma.financialSpace.findUnique({ where: { id: access.activeSpaceId }, select: { kind: true, beneficiaryUserId: true } }),
    prisma.allowanceRule.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.allowancePayout.findMany({ orderBy: { dueDate: 'desc' }, take: 30, include: { rule: { select: { name: true } } } }),
    prisma.choreTask.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  return {
    spaceKind: space?.kind ?? 'personal',
    beneficiaryUserId: space?.beneficiaryUserId ?? null,
    canManage: access.canCreate,
    rules, payouts, chores,
  };
}
