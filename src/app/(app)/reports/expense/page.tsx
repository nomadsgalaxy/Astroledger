import { buildExpenseReport, type ExpenseReport } from '@/lib/expenseReport';
import { fmt } from '@/app/_components/atoms';
import ExpenseReportActions from '@/app/_components/ExpenseReportActions';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ tag?: string; from?: string; to?: string; include_inflows?: string }>;

export default async function ExpenseReportPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tag = sp.tag ?? '';
  const from = sp.from ?? '';
  const to = sp.to ?? '';
  const includeInflows = sp.include_inflows === '1';

  if (!tag || !from || !to) {
    return (
      <div style={{ padding: 24 }}>
        <h1 className="t-section-title">Expense report</h1>
        <p className="t-section-subtitle">Missing parameters. Try the picker on <Link href="/reports">/reports</Link>.</p>
      </div>
    );
  }

  let report: ExpenseReport | null = null;
  let err: string | null = null;
  try {
    report = await buildExpenseReport({ parentTag: tag, from, to, includeInflows });
  } catch (e: any) {
    err = e?.message ?? String(e);
  }

  if (err) {
    return (
      <div style={{ padding: 24 }}>
        <h1 className="t-section-title">Expense report</h1>
        <p style={{ color: 'var(--error)' }}>{err}</p>
        <p><Link href="/reports">← Back to report picker</Link></p>
      </div>
    );
  }
  if (!report) return null;

  return (
    <div className="expense-report" style={{ padding: 24, maxWidth: 920, margin: '0 auto' }}>
      <ExpenseReportActions tag={tag} from={from} to={to} includeInflows={includeInflows} />

      <header style={{ borderBottom: '2px solid var(--fg-strong)', paddingBottom: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
          Expense Report
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 4px', color: 'var(--fg-strong)' }}>
          {report.parentTag.name}
        </h1>
        <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
          {report.range.from} → {report.range.to}
          {' · '}
          Generated {new Date(report.generatedAt).toLocaleDateString()}
          {' · '}
          {report.items.length} items, {report.receiptCount} receipts
        </div>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>
        <div style={{ border: '1px solid var(--border)', padding: 16, borderRadius: 'var(--r-sm)' }}>
          <div className="t-caption" style={{ marginBottom: 10 }}>Total</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 36, fontWeight: 600, color: 'var(--fg-strong)' }}>
            ${fmt(report.totalAbs)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
            {report.currency} · {includeInflows ? 'inflows included' : 'outflows only'}
          </div>
        </div>
        <div style={{ border: '1px solid var(--border)', padding: 16, borderRadius: 'var(--r-sm)' }}>
          <div className="t-caption" style={{ marginBottom: 10 }}>By category</div>
          <table style={{ width: '100%', fontSize: 12 }}>
            <tbody>
              {report.byCategory.slice(0, 8).map(s => (
                <tr key={s.key}>
                  <td style={{ paddingBottom: 4, color: 'var(--fg)' }}>{s.key}</td>
                  <td style={{ paddingBottom: 4, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg-strong)' }}>${fmt(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {report.byChildTag.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>By sub-tag</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left',  padding: '8px 0', color: 'var(--fg-muted)', fontSize: 10, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', fontWeight: 700 }}>Tag</th>
                <th style={{ textAlign: 'right', padding: '8px 0', color: 'var(--fg-muted)', fontSize: 10, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', fontWeight: 700 }}>Count</th>
                <th style={{ textAlign: 'right', padding: '8px 0', color: 'var(--fg-muted)', fontSize: 10, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', fontWeight: 700 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {report.byChildTag.map(s => (
                <tr key={s.key} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 0' }}>{s.key}</td>
                  <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{s.count}</td>
                  <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>${fmt(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>Line items</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Date', 'Merchant', 'Category', 'Sub-tags', 'Account', 'Amount', 'Receipts'].map(h => (
                <th key={h} style={{ textAlign: h === 'Amount' || h === 'Receipts' ? 'right' : 'left', padding: '8px 8px', color: 'var(--fg-muted)', fontSize: 10, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.items.map(it => (
              <tr key={it.txId} style={{ borderBottom: '1px solid var(--border)', pageBreakInside: 'avoid' }}>
                <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>{it.date}</td>
                <td style={{ padding: '8px 8px' }}>
                  <div style={{ fontWeight: 600 }}>{it.merchant}</div>
                  {it.description !== it.merchant && (
                    <div style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>{it.description}</div>
                  )}
                  {it.notes && <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginTop: 2 }}>Notes: {it.notes}</div>}
                </td>
                <td style={{ padding: '8px 8px', color: 'var(--fg)' }}>{it.category ?? ' - '}</td>
                <td style={{ padding: '8px 8px', fontSize: 11 }}>{it.childTags.join(', ') || ' - '}</td>
                <td style={{ padding: '8px 8px', fontSize: 11, color: 'var(--fg-muted)' }}>{it.account}</td>
                <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  ${fmt(it.amountAbs)}
                </td>
                <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                  {it.receipts.length === 0 ? ' - ' : it.receipts.map((r, i) => (
                    <a key={r.id} href={r.url} target="_blank" rel="noreferrer"
                       style={{ marginLeft: 4, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      [{i + 1}]
                    </a>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--fg-strong)' }}>
              <td colSpan={5} style={{ padding: '12px 8px', textAlign: 'right', fontSize: 11, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', fontWeight: 700, color: 'var(--fg-muted)' }}>Total</td>
              <td style={{ padding: '12px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--fg-strong)' }}>
                ${fmt(report.totalAbs)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      {/* Receipt gallery - embed images so a printed PDF includes them. */}
      {report.items.some(i => i.receipts.length > 0) && (
        <section style={{ marginTop: 36, pageBreakBefore: 'always' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>Receipts</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {report.items.flatMap((it, idx) => it.receipts.map((r, ri) => (
              <figure key={r.id} style={{ border: '1px solid var(--border)', padding: 8, borderRadius: 'var(--r-sm)', breakInside: 'avoid', margin: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 6 }}>
                  [{idx + 1}.{ri + 1}] {it.date} · {it.merchant} · ${fmt(it.amountAbs)}
                </div>
                {r.mimeType.startsWith('image/') ? (
                  <img src={r.url} alt={`receipt ${idx}-${ri}`} style={{ width: '100%', display: 'block' }} />
                ) : (
                  <a href={r.url} target="_blank" rel="noreferrer">{r.mimeType}</a>
                )}
              </figure>
            )))}
          </div>
        </section>
      )}

      {/* Print stylesheet - strips the app shell + dark theme bg on print */}
      <style>{`
        @media print {
          .no-print, .m3-bottom-nav, .m3-sidebar, .m3-sidebar-backdrop, .m3-hamburger,
          header.app-topbar, nav { display: none !important; }
          body, html { background: #fff !important; color: #000 !important; }
          .expense-report, .expense-report * { color: #000 !important; }
          .expense-report a { color: #000 !important; text-decoration: underline; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          img { max-height: 4in; object-fit: contain; }
        }
      `}</style>
    </div>
  );
}
