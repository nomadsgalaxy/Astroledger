import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buildExpenseReport, reportToCsv } from '@/lib/expenseReport';
import { getRequestFinancialAccess } from '@/lib/prisma';

export const runtime = 'nodejs';

// GET /api/reports/expense?tag=Boise&from=2026-05-01&to=2026-05-18&format=csv|json
//
// Returns the structured report payload (json default) or a CSV stream
// when format=csv. Auth via session cookie.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const tag  = url.searchParams.get('tag')  ?? '';
  const from = url.searchParams.get('from') ?? '';
  const to   = url.searchParams.get('to')   ?? '';
  const format = url.searchParams.get('format') ?? 'json';
  const includeInflows = url.searchParams.get('include_inflows') === '1';

  if (!tag || !from || !to) {
    return NextResponse.json({ error: 'tag, from, to required' }, { status: 400 });
  }

  try {
    const report = await buildExpenseReport({ parentTag: tag, from, to, includeInflows });
    if (format === 'csv') {
      const access = await getRequestFinancialAccess();
      if (!access?.canExportSpace) return NextResponse.json({ error: 'Space export permission is required for aggregate reports' }, { status: 403 });
      const csv = reportToCsv(report);
      const filename = `expense-${report.parentTag.name.replace(/\W+/g, '-')}-${from}_${to}.csv`;
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
}
