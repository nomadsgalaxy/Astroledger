import { prisma } from '@/lib/prisma';
import TransactionsClient from '../../_components/TransactionsClient';
import { getRange } from '@/lib/timeRange.server';
import { getInactiveMonths, latestTxByAccount, isStale } from '@/lib/inactiveAccounts';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

type ReviewFilter = 'unorganized' | 'anticipated' | 'pending';
type SearchParams = Promise<{ date?: string; review?: string }>;

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // Optional ?date=YYYY-MM-DD narrows the list to a single day (used by the
  // dashboard calendar's click-through). Validated against the format so a
  // junk value falls back to the global range.
  const dayFilter = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : null;
  const reviewFilter: ReviewFilter | null =
    sp.review === 'unorganized' || sp.review === 'anticipated' || sp.review === 'pending'
      ? sp.review : null;
  const range = await getRange();
  const dateWhere = dayFilter
    ? { gte: new Date(`${dayFilter}T00:00:00Z`), lte: new Date(`${dayFilter}T23:59:59.999Z`) }
    : { gte: range.since };
  const reviewWhere: Prisma.TransactionWhereInput | null = reviewFilter === 'unorganized'
    ? {
        amount: { lt: 0 }, isTransfer: false, isAnticipated: false,
        parentTransactionId: null, isSplit: false, categoryId: null,
        tags: { none: {} },
      }
    : reviewFilter === 'anticipated'
      ? { isAnticipated: true, date: { lt: new Date() } }
      : reviewFilter === 'pending'
        ? { pending: true, date: { lt: new Date(Date.now() - 7 * 86400000) } }
        : null;
  const [txs, categories, rawAccounts] = await Promise.all([
    prisma.transaction.findMany({
      where: reviewWhere ?? { date: dateWhere },
      orderBy: { date: 'desc' },
      take: dayFilter ? 500 : 500,
      include: { category: true, account: { include: { institution: true } }, subscription: true, tags: { include: { parent: { select: { name: true, color: true } } } } },
    }),
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
    prisma.bankAccount.findMany({ include: { institution: true } }),
  ]);

  // Filter stale accounts out of the picker - same threshold as /accounts.
  // Existing transactions on hidden accounts still render in the list (we
  // never filter actual data), but you can't pick a hidden account for new
  // manual entries until you go to /accounts and click "Show N inactive".
  const thresholdMonths = await getInactiveMonths();
  const latestByAcct = await latestTxByAccount(rawAccounts.map(a => a.id));
  const accounts = rawAccounts.filter(a => !isStale({
    latestTx: latestByAcct.get(a.id) ?? null,
    createdAt: a.createdAt,
    thresholdMonths,
  }));

  return (
    <TransactionsClient
      transactions={txs.map(t => ({
        id: t.id,
        uuid: t.uuid,
        date: t.date.toISOString(),
        amount: t.amount,
        merchant: t.merchant ?? 'Unknown',
        rawDescription: t.rawDescription,
        category: t.category?.name ?? 'Other',
        categoryColor: t.category?.color ?? null,
        accountId: t.accountId,
        accountName: t.account.name,
        institutionName: t.account.institution.name,
        accountMask: t.account.mask ?? '',
        pending: t.pending,
        isRecurring: !!t.subscriptionId,
        isAnticipated: t.isAnticipated,
        note: t.notes,
        tags: t.tags.map(tag => ({
          id: tag.id, name: tag.name, color: tag.color,
          kind: (tag.kind === 'primary' ? 'primary' : 'secondary') as 'primary' | 'secondary',
          parentId: tag.parentId, parentName: tag.parent?.name ?? null,
          parentColor: tag.parent?.color ?? null,
        })),
      }))}
      categories={categories.map(c => ({ name: c.name, color: c.color }))}
      accounts={accounts.map(a => ({
        id: a.id,
        // `label` is kept for back-compat (used by the top-of-list "All accounts"
        // filter pill). The new picker prefers the structured name/mask/institution
        // fields, which lead with the account name as primary identity.
        label: `${a.name}${a.mask ? ` (${a.mask})` : ''} · ${a.institution.name}`,
        name: a.name,
        mask: a.mask,
        institution: a.institution.name,
      }))}
      rangeLabel={reviewFilter ? `Review · ${reviewFilter}` : dayFilter ?? range.label}
      dayFilter={dayFilter}
      reviewFilter={reviewFilter}
    />
  );
}
