import { buildStatements, resolvePeriod, type FinancialStatements } from '@/lib/statements';
import { getRange } from '@/lib/timeRange.server';
import { fmt } from '@/app/_components/atoms';
import StatementsControls from '@/app/_components/StatementsControls';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ from?: string; to?: string }>;

const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 8px', color: 'var(--fg-muted)', fontSize: 10,
  letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', fontWeight: 700,
};
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '7px 8px', fontSize: 13 };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' };

function StatementHeader({ kicker, title, sub, csvHref }: { kicker: string; title: string; sub: string; csvHref: string }) {
  return (
    <header style={{ borderBottom: '2px solid var(--fg-strong)', paddingBottom: 12, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{kicker}</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 2px', color: 'var(--fg-strong)' }}>{title}</h2>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{sub}</div>
      </div>
      <a className="no-print" href={csvHref} style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>↓ CSV</a>
    </header>
  );
}

export default async function StatementsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const range = await getRange();
  const from = sp.from || range.since.toISOString().slice(0, 10);
  const to = sp.to || range.until.toISOString().slice(0, 10);

  let s: FinancialStatements | null = null;
  let err: string | null = null;
  try {
    const { from: f, to: t } = resolvePeriod(from, to);
    s = await buildStatements({ from: f, to: t });
  } catch (e: any) {
    err = e?.message ?? String(e);
  }

  const csv = (statement: string) =>
    `/api/reports/statements?` + new URLSearchParams({ from, to, statement, format: 'csv' }).toString();

  return (
    <div className="statements" style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 920, margin: '0 auto', padding: '4px 0' }}>
      <div className="no-print">
        <div style={{ fontSize: 11, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
          Reports · <Link href="/reports" style={{ color: 'var(--accent)' }}>back</Link>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 4px', color: 'var(--fg-strong)' }}>Financial statements</h1>
        <p style={{ fontSize: 13, color: 'var(--fg-muted)', margin: 0 }}>
          Balance Sheet, Income Statement (P&amp;L), and Cash Flow for any period — ready to hand to an accountant. Export each as CSV or print to PDF.
        </p>
      </div>

      <StatementsControls from={from} to={to} csvAllHref={csv('all')} />

      {err && <div style={{ color: 'var(--error)', fontSize: 13 }}>{err}</div>}

      {s && (
        <>
          {/* ---------------- Balance Sheet ---------------- */}
          <section>
            <StatementHeader kicker="Statement of financial position" title="Balance Sheet"
              sub={`As of ${s.balanceSheet.asOf} · ${s.balanceSheet.baseCurrency}`} csvHref={csv('balance_sheet')} />
            <BalanceSide title="Assets" groups={s.balanceSheet.assets} total={s.balanceSheet.totalAssets} totalLabel="Total assets" />
            <BalanceSide title="Liabilities" groups={s.balanceSheet.liabilities} total={s.balanceSheet.totalLiabilities} totalLabel="Total liabilities" />
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--fg-strong)', marginTop: 10, padding: '12px 8px' }}>
              <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 'var(--tr-wider)' }}>Net worth</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)' }}>{fmt(s.balanceSheet.netWorth)}</span>
            </div>
            <Notes notes={s.balanceSheet.notes} />
          </section>

          {/* ---------------- Income Statement ---------------- */}
          <section>
            <StatementHeader kicker="Profit & loss" title="Income Statement"
              sub={`${s.incomeStatement.from} → ${s.incomeStatement.to} · ${s.incomeStatement.baseCurrency}`} csvHref={csv('income_statement')} />
            <LineTable label="Income" lines={s.incomeStatement.income} total={s.incomeStatement.totalIncome} totalLabel="Total income" />
            <LineTable label="Expenses" lines={s.incomeStatement.expenses} total={s.incomeStatement.totalExpenses} totalLabel="Total expenses" />
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--fg-strong)', marginTop: 10, padding: '12px 8px' }}>
              <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 'var(--tr-wider)' }}>Net income</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: s.incomeStatement.netIncome >= 0 ? 'var(--success)' : 'var(--error)' }}>
                {fmt(s.incomeStatement.netIncome, { sign: true })}
              </span>
            </div>
            <Notes notes={s.incomeStatement.notes} />
          </section>

          {/* ---------------- Cash Flow ---------------- */}
          <section>
            <StatementHeader kicker="Statement of cash flows" title="Cash Flow"
              sub={`${s.cashFlow.from} → ${s.cashFlow.to} · ${s.cashFlow.baseCurrency}`} csvHref={csv('cash_flow')} />
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <CfRow label="Operating — inflows" value={s.cashFlow.operating.inflows} />
                <CfRow label="Operating — outflows" value={-s.cashFlow.operating.outflows} />
                <CfRow label="Net operating activities" value={s.cashFlow.operating.net} strong />
                <CfRow label="Investing (to/from investments)" value={s.cashFlow.investing.net} />
                <CfRow label="Financing (to/from debt)" value={s.cashFlow.financing.net} />
                <CfRow label="Other / internal transfers" value={s.cashFlow.other.net} />
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...td, color: 'var(--fg-muted)' }}>Beginning cash</td>
                  <td style={tdNum}>{s.cashFlow.beginningCash == null ? '—' : fmt(s.cashFlow.beginningCash)}</td>
                </tr>
                <tr>
                  <td style={{ ...td, fontWeight: 700 }}>Net change in cash</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{fmt(s.cashFlow.netChangeInCash, { sign: true })}</td>
                </tr>
                <tr style={{ borderTop: '2px solid var(--fg-strong)' }}>
                  <td style={{ ...td, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 'var(--tr-wider)', fontSize: 12 }}>Ending cash</td>
                  <td style={{ ...tdNum, fontWeight: 700, fontSize: 16, color: 'var(--fg-strong)' }}>{s.cashFlow.endingCash == null ? '—' : fmt(s.cashFlow.endingCash)}</td>
                </tr>
              </tfoot>
            </table>
            <Notes notes={s.cashFlow.notes} />
          </section>
        </>
      )}

      {/* Print stylesheet — strips the app shell + dark theme on print/PDF. */}
      <style>{`
        @media print {
          .no-print, .m3-bottom-nav, .m3-sidebar, .m3-sidebar-backdrop, .m3-hamburger,
          header.app-topbar, nav { display: none !important; }
          body, html { background: #fff !important; color: #000 !important; }
          .statements, .statements * { color: #000 !important; }
          .statements section { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}

function BalanceSide({ title, groups, total, totalLabel }: {
  title: string; groups: FinancialStatements['balanceSheet']['assets']; total: number; totalLabel: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 'var(--tr-wider)', color: 'var(--fg-muted)', margin: '4px 0 6px' }}>{title}</h3>
      {groups.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)', padding: '6px 8px' }}>None.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {groups.map(g => (
              <GroupBlock key={g.kind} g={g} />
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid var(--fg-strong)' }}>
              <td style={{ ...td, fontWeight: 700 }}>{totalLabel}</td>
              <td style={{ ...tdNum, fontWeight: 700 }}>{fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

function GroupBlock({ g }: { g: FinancialStatements['balanceSheet']['assets'][number] }) {
  return (
    <>
      <tr style={{ borderBottom: '1px solid var(--border)' }}>
        <td style={{ ...td, fontWeight: 600 }} colSpan={1}>{g.label}</td>
        <td style={{ ...tdNum, fontWeight: 600 }}>{fmt(g.total)}</td>
      </tr>
      {g.accounts.map((a, i) => (
        <tr key={g.kind + i}>
          <td style={{ ...td, paddingLeft: 22, color: 'var(--fg-muted)', fontSize: 12 }}>{a.name} <span style={{ color: 'var(--fg-subtle)' }}>· {a.institution}</span></td>
          <td style={{ ...tdNum, color: 'var(--fg-muted)', fontSize: 12 }}>{fmt(a.balance)}</td>
        </tr>
      ))}
    </>
  );
}

function LineTable({ label, lines, total, totalLabel }: {
  label: string; lines: FinancialStatements['incomeStatement']['income']; total: number; totalLabel: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 'var(--tr-wider)', color: 'var(--fg-muted)', margin: '4px 0 6px' }}>{label}</h3>
      {lines.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)', padding: '6px 8px' }}>None in this period.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={th}>Category</th>
              <th style={thR}>Count</th>
              <th style={thR}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.bucket + i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={td}>{l.bucket}</td>
                <td style={tdNum}>{l.count}</td>
                <td style={tdNum}>{fmt(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid var(--fg-strong)' }}>
              <td style={{ ...td, fontWeight: 700 }}>{totalLabel}</td>
              <td />
              <td style={{ ...tdNum, fontWeight: 700 }}>{fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

function CfRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ ...td, fontWeight: strong ? 700 : 400 }}>{label}</td>
      <td style={{ ...tdNum, fontWeight: strong ? 700 : 400 }}>{fmt(value, { sign: true })}</td>
    </tr>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <ul style={{ margin: '10px 0 0', padding: '0 0 0 16px', fontSize: 11, color: 'var(--fg-subtle)', lineHeight: 1.6 }}>
      {notes.map((n, i) => <li key={i}>{n}</li>)}
    </ul>
  );
}
