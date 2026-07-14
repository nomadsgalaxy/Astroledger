import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buildStatements, statementsToCsv, resolvePeriod } from '@/lib/statements';
import { getRequestFinancialAccess } from '@/lib/prisma';

export const runtime = 'nodejs';

// GET /api/reports/statements?from=2026-01-01&to=2026-06-30&statement=all&format=csv|json
//
// statement ∈ balance_sheet | income_statement | cash_flow | all (default all)
// format    ∈ json (default) | csv
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const format = url.searchParams.get('format') ?? 'json';
  const which = (url.searchParams.get('statement') ?? 'all') as
    'balance_sheet' | 'income_statement' | 'cash_flow' | 'all';

  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 });

  try {
    const { from: f, to: t } = resolvePeriod(from, to);
    const statements = await buildStatements({ from: f, to: t });
    if (format === 'csv') {
      const access = await getRequestFinancialAccess();
      if (!access?.canExportSpace) return NextResponse.json({ error: 'Space export permission is required for aggregate reports' }, { status: 403 });
      const csv = statementsToCsv(statements, which);
      const filename = `statements-${which}-${from}_${to}.csv`;
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }
    return NextResponse.json(statements);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
}
