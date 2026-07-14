// Link Order rows to Transaction rows.
// Heuristic: date within ±3 days, amount within $0.50 or 1%, merchant similarity ≥ 0.6.

import { prisma } from './prisma';

const DATE_WINDOW_DAYS = 3;

function similarity(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const set = new Set(x.split(/\s+/));
  const overlap = y.split(/\s+/).filter(t => set.has(t)).length;
  return overlap / Math.max(set.size, y.split(/\s+/).length);
}

function amountClose(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff <= 0.5 || diff / Math.max(a, b) <= 0.01;
}

export async function matchOrders(opts: { onlyOrderId?: string } = {}) {
  const orders = await prisma.order.findMany({
    where: { ...(opts.onlyOrderId ? { id: opts.onlyOrderId } : {}), transactionId: null },
  });
  let linked = 0;

  for (const o of orders) {
    const minDate = new Date(+o.orderDate - DATE_WINDOW_DAYS * 86400000);
    const maxDate = new Date(+o.orderDate + DATE_WINDOW_DAYS * 86400000);
    const candidates = await prisma.transaction.findMany({
      where: {
        date: { gte: minDate, lte: maxDate },
        amount: { lt: 0 },                       // outflow only
      },
      select: { id: true, merchant: true, amount: true, date: true },
    });
    // Score candidates
    let best: { id: string; score: number } | null = null;
    for (const c of candidates) {
      const amtAbs = Math.abs(c.amount);
      if (!amountClose(amtAbs, o.amount)) continue;
      const sim = similarity(c.merchant ?? '', o.merchant);
      if (sim < 0.4) continue;
      const dateDiff = Math.abs(+c.date - +o.orderDate) / 86400000;
      const score = sim * 0.6 + (1 - dateDiff / DATE_WINDOW_DAYS) * 0.3 + (amountClose(amtAbs, o.amount) ? 0.1 : 0);
      if (!best || score > best.score) best = { id: c.id, score };
    }
    if (best && best.score >= 0.55) {
      await prisma.order.update({ where: { id: o.id }, data: { transactionId: best.id } });
      linked++;
    }
  }
  return { matched: linked, totalOrders: orders.length };
}
