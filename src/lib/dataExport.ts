// Full data export — "leave anytime, take everything." Three formats:
//   • transactions CSV  — every transaction + metadata, RFC-4180
//   • QIF               — multi-account Quicken export (round-trips with the
//                         importer, incl. L[bracket] transfer notation)
//   • full JSON dump    — denormalized snapshot of every user table
//
// Read-only; no schema changes. Auth is enforced at the route layer.

import { prisma } from './prisma';

// RFC-4180 cell escape (same discipline as expenseReport.reportToCsv).
function esc(s: string | number | null | undefined): string {
  if (s == null) return '';
  const str = String(s);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export type ExportFilter = {
  from?: Date;
  to?: Date;
  accountId?: string;
  includeTransfers?: boolean; // default true
  allowedAccountIds?: string[]; // capability boundary supplied by route
};

function whereFromFilter(f: ExportFilter = {}) {
  const where: any = {};
  if (f.from || f.to) where.date = {};
  if (f.from) where.date.gte = f.from;
  if (f.to) where.date.lte = f.to;
  if (f.accountId) where.accountId = f.accountId;
  if (f.allowedAccountIds) {
    where.accountId = f.accountId
      ? (f.allowedAccountIds.includes(f.accountId) ? f.accountId : '__denied__')
      : { in: f.allowedAccountIds };
  }
  if (f.includeTransfers === false) where.isTransfer = false;
  return where;
}

// ── Transactions CSV ────────────────────────────────────────────────────────
export async function transactionsToCSV(filter: ExportFilter = {}): Promise<string> {
  const txs = await prisma.transaction.findMany({
    where: whereFromFilter(filter),
    orderBy: { date: 'desc' },
    include: {
      account: { include: { institution: { select: { name: true } } } },
      category: { select: { name: true } },
      tags: { select: { name: true } },
    },
  });
  const header = [
    'Date', 'Account', 'Institution', 'Merchant', 'Description', 'Amount', 'Currency',
    'Category', 'Tags', 'IsTransfer', 'IsSplit', 'Cleared', 'Pending', 'IsAnticipated',
    'TransferGroupId', 'Notes', 'UUID',
  ];
  const lines = [header.map(esc).join(',')];
  for (const t of txs) {
    lines.push([
      t.date.toISOString().slice(0, 10),
      t.account?.name ?? '',
      t.account?.institution?.name ?? '',
      t.merchant ?? '',
      t.rawDescription ?? '',
      t.amount.toFixed(2),
      t.currency ?? 'USD',
      t.category?.name ?? '',
      t.tags.map(tg => tg.name).join('; '),
      t.isTransfer ? 'yes' : '',
      t.isSplit ? 'yes' : '',
      t.cleared ? 'yes' : '',
      t.pending ? 'yes' : '',
      t.isAnticipated ? 'yes' : '',
      t.transferGroupId ?? '',
      t.notes ?? '',
      t.uuid ?? '',
    ].map(esc).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// ── QIF export ──────────────────────────────────────────────────────────────
// Maps Astroledger account kinds → QIF account-type tags. Inverse of
// quickenImport.mapQifType.
function qifTypeFor(type: string, kind: string | null): string {
  const k = (kind || type || '').toLowerCase();
  if (k.includes('credit')) return 'CCard';
  if (k.includes('invest')) return 'Invst';
  if (k.includes('loan')) return 'Oth L';
  return 'Bank';
}
function qifDate(d: Date): string {
  // Quicken US format M/D'YY (matches what the importer parses).
  const mm = d.getUTCMonth() + 1, dd = d.getUTCDate(), yy = String(d.getUTCFullYear()).slice(2);
  return `${mm}/${dd}'${yy}`;
}

export async function transactionsToQIF(filter: ExportFilter = {}): Promise<string> {
  const accounts = await prisma.bankAccount.findMany({
    where: filter.accountId
      ? { id: filter.allowedAccountIds?.includes(filter.accountId) === false ? '__denied__' : filter.accountId }
      : filter.allowedAccountIds ? { id: { in: filter.allowedAccountIds } } : {},
    orderBy: { name: 'asc' },
  });

  // Resolve, for each transferGroupId, the OTHER account's name (the leg not on
  // the current row) so we can emit Quicken's L[Account] transfer notation that
  // quickenImport's parseQifTransferRef reads back.
  const groupedLegs = await prisma.transaction.findMany({
    where: { isTransfer: true, transferGroupId: { not: null } },
    select: { transferGroupId: true, accountId: true, account: { select: { name: true } } },
  });
  const legsByGroup = new Map<string, Array<{ accountId: string; name: string }>>();
  for (const l of groupedLegs) {
    const g = legsByGroup.get(l.transferGroupId!) ?? [];
    g.push({ accountId: l.accountId, name: l.account.name });
    legsByGroup.set(l.transferGroupId!, g);
  }
  const counterAccountName = (groupId: string | null, thisAccountId: string): string | null => {
    if (!groupId) return null;
    const legs = legsByGroup.get(groupId);
    if (!legs) return null;
    const other = legs.find(l => l.accountId !== thisAccountId);
    return other?.name ?? null;
  };

  const out: string[] = [];
  for (const a of accounts) {
    const txs = await prisma.transaction.findMany({
      where: { ...whereFromFilter(filter), accountId: a.id },
      orderBy: { date: 'asc' },
      include: { category: { select: { name: true } } },
    });
    if (txs.length === 0) continue;
    const qType = qifTypeFor(a.type, a.kind);
    out.push('!Account');
    out.push(`N${a.name}`);
    out.push(`T${qType}`);
    out.push('^');
    out.push(`!Type:${qType}`);
    for (const t of txs) {
      out.push(`D${qifDate(t.date)}`);
      out.push(`T${t.amount.toFixed(2)}`);
      if (t.merchant) out.push(`P${t.merchant}`);
      if (t.rawDescription && t.rawDescription !== t.merchant) out.push(`M${t.rawDescription}`);
      // Transfer → bracketed L[CounterAccount] (round-trips with the importer);
      // a one-sided transfer with no resolvable counter-account falls back to a
      // plain "Transfer" category; otherwise use the real category.
      if (t.isTransfer) {
        const other = counterAccountName(t.transferGroupId, t.accountId);
        out.push(other ? `L[${other}]` : 'LTransfer');
      } else if (t.category?.name) {
        out.push(`L${t.category.name}`);
      }
      out.push('^');
    }
  }
  return out.join('\n') + '\n';
}

// ── Full JSON dump ──────────────────────────────────────────────────────────
export type FullDump = Record<string, unknown> & { exportedAt: string; version: string };

export async function fullDataDump(options: { allowedAccountIds?: string[]; includeSpaceData?: boolean } = {}): Promise<FullDump> {
  const accountWhere = options.allowedAccountIds ? { id: { in: options.allowedAccountIds } } : {};
  const transactionWhere = options.allowedAccountIds ? { accountId: { in: options.allowedAccountIds } } : {};
  const includeSpaceData = options.includeSpaceData !== false;
  const [
    institutions, accounts, categories, tags, transactions, subscriptions,
    budgets, goals, rules, envelopes, fxRates, holdings, securities,
    securityPrices, investmentTxns, orders, netWorthSnapshots,
  ] = await Promise.all([
    prisma.institution.findMany({ select: { id: true, name: true, source: true, createdAt: true, lastSyncedAt: true, lastSyncStatus: true } }),
    prisma.bankAccount.findMany({ where: accountWhere }),
    prisma.category.findMany(),
    prisma.tag.findMany(),
    prisma.transaction.findMany({ where: transactionWhere, include: { tags: { select: { id: true } } } }),
    includeSpaceData ? prisma.subscription.findMany({ include: { tags: { select: { id: true } } } }) : Promise.resolve([]),
    includeSpaceData ? prisma.budget.findMany() : Promise.resolve([]),
    includeSpaceData ? prisma.goal.findMany() : Promise.resolve([]),
    includeSpaceData ? prisma.rule.findMany() : Promise.resolve([]),
    includeSpaceData ? prisma.envelope.findMany() : Promise.resolve([]),
    prisma.fxRate.findMany(),
    prisma.holding.findMany({ where: options.allowedAccountIds ? { accountId: { in: options.allowedAccountIds } } : {} }),
    prisma.security.findMany(),
    prisma.securityPrice.findMany(),
    prisma.investmentTxn.findMany({ where: options.allowedAccountIds ? { accountId: { in: options.allowedAccountIds } } : {} }),
    includeSpaceData ? prisma.order.findMany() : Promise.resolve([]),
    includeSpaceData ? prisma.netWorthSnapshot.findMany() : Promise.resolve([]),
  ]);

  // Note: Institution.accessToken (encrypted credential) + Order.raw are
  // intentionally NOT included — the dump is for the user's own data, not for
  // re-exposing connector secrets. Flatten tag relations to id arrays.
  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    institutions,
    accounts,
    categories,
    tags,
    transactions: transactions.map((t: any) => ({ ...t, tags: t.tags.map((x: any) => x.id) })),
    subscriptions: subscriptions.map((s: any) => ({ ...s, tags: s.tags.map((x: any) => x.id) })),
    budgets, goals, rules, envelopes, fxRates,
    holdings, securities, securityPrices, investmentTxns,
    orders: orders.map((o: any) => ({ ...o, raw: undefined })),
    netWorthSnapshots,
  };
}
