import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { transactionsToCSV, transactionsToQIF, fullDataDump, type ExportFilter } from '@/lib/dataExport';
import { getRequestFinancialAccess } from '@/lib/prisma';
import { recordSpaceEvent } from '@/lib/spaceEvents';

export const runtime = 'nodejs';
export const maxDuration = 120;

// GET /api/export?format=csv|qif|json [&from=&to=&account=&include_transfers=0]
//   csv  → all transactions as CSV
//   qif  → multi-account Quicken QIF (round-trips with the importer)
//   json → full denormalized data dump (every user table)
// Auth via session cookie. Returns a download (Content-Disposition attachment).
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getRequestFinancialAccess();
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const format = (url.searchParams.get('format') ?? 'json').toLowerCase();
  const stamp = new Date().toISOString().slice(0, 10);

  const filter: ExportFilter = {};
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const account = url.searchParams.get('account');
  if (from) filter.from = new Date(from);
  if (to) filter.to = new Date(to);
  if (account) filter.accountId = account;
  if (account && !access.exportAccountIds.includes(account)) {
    return NextResponse.json({ error: 'Export permission is required for that account' }, { status: 403 });
  }
  filter.allowedAccountIds = account ? [account] : access.exportAccountIds;
  if (!filter.allowedAccountIds.length) return NextResponse.json({ error: 'Export permission is required' }, { status: 403 });
  if (url.searchParams.get('include_transfers') === '0') filter.includeTransfers = false;

  await recordSpaceEvent({
    spaceId: access.activeSpaceId, actorId: access.userId, action: 'export.create', targetType: 'export',
    summary: `Exported ${format} data (${filter.allowedAccountIds.length} account${filter.allowedAccountIds.length === 1 ? '' : 's'})`,
    after: { format, accountId: account ?? null, from: from ?? null, to: to ?? null },
  });

  try {
    if (format === 'csv') {
      const csv = await transactionsToCSV(filter);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="astroledger-transactions-${stamp}.csv"`,
        },
      });
    }
    if (format === 'qif') {
      const qif = await transactionsToQIF(filter);
      return new NextResponse(qif, {
        headers: {
          'Content-Type': 'application/qif; charset=utf-8',
          'Content-Disposition': `attachment; filename="astroledger-${stamp}.qif"`,
        },
      });
    }
    if (format === 'json') {
      const dump = await fullDataDump({ allowedAccountIds: filter.allowedAccountIds, includeSpaceData: access.canExportSpace });
      return new NextResponse(JSON.stringify(dump, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="astroledger-full-export-${stamp}.json"`,
        },
      });
    }
    return NextResponse.json({ error: 'format must be csv | qif | json' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
