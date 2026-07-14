'use client';
import { Btn } from './atoms';

// Print + CSV actions for the expense-report page. Client-only so window.print()
// works; the rest of the report page is a server component for fast SSR.
export default function ExpenseReportActions({ tag, from, to, includeInflows }: {
  tag: string; from: string; to: string; includeInflows: boolean;
}) {
  const csvHref = `/api/reports/expense?` + new URLSearchParams({
    tag, from, to, format: 'csv', ...(includeInflows ? { include_inflows: '1' } : {}),
  }).toString();
  return (
    <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 16 }}>
      <Btn variant="outline" size="md" icon="↓" onClick={() => { window.location.href = csvHref; }}>
        CSV
      </Btn>
      <Btn variant="primary" size="md" icon="⎙" onClick={() => window.print()}>
        Print / Save as PDF
      </Btn>
    </div>
  );
}
