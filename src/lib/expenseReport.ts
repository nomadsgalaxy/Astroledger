// Build an expense report bundle for a parent tag + date range.
// "Parent tag" semantics: the report includes every transaction tagged with
// the parent itself OR any of its child tags (so a trip tag like
// "Work Travel - Boise May 2026" with children {Meals, Lodging, Flights}
// works without the user having to enumerate the children).
//
// The output is structured so it can be:
// - rendered as a printable HTML report (the /reports/expense page),
// - serialized to CSV,
// - returned over the MCP tool surface to an external agent.

import { prisma } from './prisma';

export type ReportLineItem = {
  txId: string;
  date: string;                  // YYYY-MM-DD
  merchant: string;
  description: string;
  amountSigned: number;          // negative = outflow
  amountAbs: number;             // positive magnitude (what gets summed)
  isReimbursable: boolean;       // outflow only - inflows are excluded by default
  category: string | null;
  childTags: string[];           // child tag names (under the parent)
  otherTags: string[];           // other tags (not children of parent)
  account: string;               // institution + mask
  receipts: Array<{ id: string; mimeType: string; url: string; thumbnail?: string }>;
  notes: string | null;
};

export type ReportSection = {
  // Roll-up of line items by some grouping key. Used for "by child tag" and
  // "by category" summaries on the report header.
  key: string;
  total: number;        // absolute total
  count: number;
};

export type ExpenseReport = {
  parentTag: { id: string; name: string; color: string | null };
  range: { from: string; to: string };
  generatedAt: string;
  items: ReportLineItem[];
  totalAbs: number;
  totalSigned: number;
  byChildTag: ReportSection[];
  byCategory: ReportSection[];
  receiptCount: number;
  currency: string;     // hardcoded USD for MVP - Astroledger is single-currency today
};

export type BuildReportOptions = {
  parentTag: string;            // case-insensitive name match
  from: string;                 // YYYY-MM-DD inclusive
  to: string;                   // YYYY-MM-DD inclusive
  includeInflows?: boolean;     // default false - reimbursements only confuse expense reports
};

function ymd(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

export async function buildExpenseReport(opts: BuildReportOptions): Promise<ExpenseReport> {
  if (!opts.parentTag) throw new Error('parentTag required');
  if (!opts.from || !opts.to) throw new Error('from and to required');

  // Resolve the parent tag (case-insensitive). Note: SQLite is case-sensitive
  // for LIKE/equals by default - do an explicit lowered compare via raw query
  // if needed, but Prisma's findFirst with `mode: 'insensitive'` is unsupported
  // on SQLite. So we fetch candidates and match in JS.
  const candidates = await prisma.tag.findMany({
    where: { kind: 'primary' },
    select: { id: true, name: true, color: true },
  });
  const wanted = opts.parentTag.trim().toLowerCase();
  const parent = candidates.find(t => t.name.toLowerCase() === wanted)
              ?? candidates.find(t => t.name.toLowerCase().includes(wanted));
  if (!parent) throw new Error(`No primary tag matching "${opts.parentTag}"`);

  // Pull child tags so we can label sections
  const children = await prisma.tag.findMany({
    where: { parentId: parent.id },
    select: { id: true, name: true },
  });
  const childIdSet = new Set(children.map(c => c.id));
  const childIdToName = new Map(children.map(c => [c.id, c.name]));

  const from = new Date(opts.from + 'T00:00:00.000Z');
  const to   = new Date(opts.to   + 'T23:59:59.999Z');
  if (Number.isNaN(+from) || Number.isNaN(+to) || to < from) {
    throw new Error('Invalid date range');
  }

  // Pull all transactions tagged with the parent OR any of its children
  const tagIds = [parent.id, ...children.map(c => c.id)];
  const txns = await prisma.transaction.findMany({
    where: {
      date: { gte: from, lte: to },
      tags: { some: { id: { in: tagIds } } },
      ...(opts.includeInflows ? {} : { amount: { lt: 0 } }),
    },
    include: {
      account: { include: { institution: true } },
      category: { select: { name: true } },
      tags: { select: { id: true, name: true, parentId: true } },
      receipts: { select: { id: true, mimeType: true, originalName: true } },
    },
    orderBy: { date: 'asc' },
  });

  const items: ReportLineItem[] = txns.map(t => {
    const tagOnTx = t.tags;
    const childOnTx = tagOnTx.filter(tag => childIdSet.has(tag.id));
    const otherOnTx = tagOnTx.filter(tag => !childIdSet.has(tag.id) && tag.id !== parent.id);
    const account = `${t.account.institution.name} ${t.account.mask ?? ''}`.trim();
    return {
      txId: t.id,
      date: ymd(t.date),
      merchant: t.merchant ?? '(unknown)',
      description: t.rawDescription,
      amountSigned: t.amount,
      amountAbs: Math.abs(t.amount),
      isReimbursable: t.amount < 0,
      category: t.category?.name ?? null,
      childTags: childOnTx.map(c => c.name),
      otherTags: otherOnTx.map(o => o.name),
      account,
      receipts: t.receipts.map(r => ({
        id: r.id,
        mimeType: r.mimeType,
        url: `/api/receipts/${r.id}`,
      })),
      notes: t.notes,
    };
  });

  // Roll-ups
  const childGroup = new Map<string, ReportSection>();
  const catGroup   = new Map<string, ReportSection>();
  let totalAbs = 0;
  let totalSigned = 0;
  let receiptCount = 0;
  for (const it of items) {
    totalAbs += it.amountAbs;
    totalSigned += it.amountSigned;
    receiptCount += it.receipts.length;

    // Bucket by child tag - a tx with multiple child tags appears in each bucket.
    // For the section total we credit the FULL amount to each so the user can
    // see e.g. how much was spent on "Meals" even when a meal was also tagged
    // "Client dinner". A "(unbucketed)" key holds tx tagged with parent only.
    if (it.childTags.length === 0) {
      const k = '(no child tag)';
      const cur = childGroup.get(k) ?? { key: k, total: 0, count: 0 };
      cur.total += it.amountAbs; cur.count++;
      childGroup.set(k, cur);
    } else {
      for (const c of it.childTags) {
        const cur = childGroup.get(c) ?? { key: c, total: 0, count: 0 };
        cur.total += it.amountAbs; cur.count++;
        childGroup.set(c, cur);
      }
    }

    const catKey = it.category ?? '(uncategorized)';
    const ccur = catGroup.get(catKey) ?? { key: catKey, total: 0, count: 0 };
    ccur.total += it.amountAbs; ccur.count++;
    catGroup.set(catKey, ccur);
  }

  const byChildTag = Array.from(childGroup.values()).sort((a, b) => b.total - a.total);
  const byCategory = Array.from(catGroup.values()).sort((a, b) => b.total - a.total);

  return {
    parentTag: parent,
    range: { from: opts.from, to: opts.to },
    generatedAt: new Date().toISOString(),
    items,
    totalAbs,
    totalSigned,
    byChildTag,
    byCategory,
    receiptCount,
    currency: 'USD',
  };
}

// CSV serializer - RFC 4180 quoting. Suitable for direct download.
export function reportToCsv(report: ExpenseReport): string {
  const esc = (s: string | number | null | undefined): string => {
    if (s == null) return '';
    const str = String(s);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines: string[] = [];
  lines.push([
    'Date', 'Merchant', 'Description', 'Amount', 'Category',
    'Child tags', 'Other tags', 'Account', 'Receipts', 'Notes',
  ].map(esc).join(','));
  for (const it of report.items) {
    lines.push([
      it.date, it.merchant, it.description, it.amountAbs.toFixed(2),
      it.category ?? '',
      it.childTags.join('; '),
      it.otherTags.join('; '),
      it.account,
      it.receipts.length,
      it.notes ?? '',
    ].map(esc).join(','));
  }
  lines.push(''); // blank
  lines.push([esc('TOTAL'), '', '', report.totalAbs.toFixed(2)].join(','));
  return lines.join('\n');
}
