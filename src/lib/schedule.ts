// Unified recurring "schedule" (v0.5.0). Aggregates the recurring money events
// Astroledger knows about — auto-detected Subscriptions (outflows) + manual
// Schedule entries (signed: income or expense) — into one upcoming timeline and
// a monthly-commitment summary, so you can see everything that recurs and what
// it nets to per month. Manual Schedules also feed the cashflow projection.

import { prisma } from './prisma';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DAY = 86400000;

export type ScheduleEvent = {
  date: string;        // YYYY-MM-DD
  name: string;
  amount: number;      // signed: negative = outflow, positive = inflow
  source: 'subscription' | 'manual';
  cadenceDays: number;
};

export type MonthlyCommitments = {
  recurringOut: number;   // $/mo of recurring outflow (subs + manual expenses)
  recurringIn: number;    // $/mo of recurring inflow (manual income)
  net: number;            // in − out
  subscriptionCount: number;
  manualCount: number;
};

// Monthly-equivalent of every active recurring item.
export async function monthlyCommitments(): Promise<MonthlyCommitments> {
  const [subs, manual] = await Promise.all([
    prisma.subscription.findMany({ where: { status: 'active' }, select: { amount: true, cadenceDays: true } }),
    prisma.schedule.findMany({ where: { active: true }, select: { amount: true, cadenceDays: true } }),
  ]);
  let recurringOut = 0, recurringIn = 0;
  for (const s of subs) recurringOut += Math.abs(s.amount) * (30 / Math.max(1, s.cadenceDays));
  for (const m of manual) {
    const perMonth = m.amount * (30 / Math.max(1, m.cadenceDays));
    if (perMonth >= 0) recurringIn += perMonth; else recurringOut += -perMonth;
  }
  recurringOut = round2(recurringOut); recurringIn = round2(recurringIn);
  return { recurringOut, recurringIn, net: round2(recurringIn - recurringOut), subscriptionCount: subs.length, manualCount: manual.length };
}

// Upcoming occurrences over the next `days`, chronological.
export async function upcomingEvents(days = 60): Promise<ScheduleEvent[]> {
  const today = new Date();
  const horizon = new Date(+today + days * DAY);
  const out: ScheduleEvent[] = [];

  const [subs, manual] = await Promise.all([
    prisma.subscription.findMany({ where: { status: 'active' }, select: { merchant: true, amount: true, cadence: true, cadenceDays: true, nextEstimate: true } }),
    prisma.schedule.findMany({ where: { active: true }, select: { name: true, amount: true, cadenceDays: true, nextDate: true } }),
  ]);

  const project = (start: Date | null, cadenceDays: number, name: string, amount: number, source: ScheduleEvent['source']) => {
    if (!start) return;
    const step = Math.max(1, cadenceDays) * DAY;
    let when = start.getTime();
    // catch up to today if the stored next date is in the past
    while (when < +today) when += step;
    let safety = 0;
    while (when <= +horizon && safety++ < 200) {
      out.push({ date: new Date(when).toISOString().slice(0, 10), name, amount, source, cadenceDays });
      when += step;
    }
  };

  for (const s of subs) project(s.nextEstimate, s.cadenceDays, s.merchant, -Math.abs(s.amount), 'subscription');
  for (const m of manual) project(m.nextDate, m.cadenceDays, m.name, m.amount, 'manual');

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
