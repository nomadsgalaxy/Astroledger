'use client';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export default function MonthlyTrendChart({ data }: { data: Array<{ month: string; inflow: number; outflow: number; net: number }> }) {
  if (!data.length) return <p className="text-ink-500 text-sm">No data yet.</p>;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#222637" />
          <XAxis dataKey="month" stroke="#5a6280" fontSize={12} />
          <YAxis stroke="#5a6280" fontSize={12} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip contentStyle={{ background: '#11131c', border: '1px solid #222637', borderRadius: 8 }} />
          <Line type="monotone" dataKey="inflow" stroke="#34d399" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="outflow" stroke="#ef4444" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="net" stroke="#6ee7b7" strokeWidth={2} strokeDasharray="4 4" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
