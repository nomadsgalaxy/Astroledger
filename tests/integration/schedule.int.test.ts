import { describe, it, expect, beforeEach } from 'vitest';
import { reset, prisma } from './_fixtures';
import { monthlyCommitments, upcomingEvents } from '../../src/lib/schedule';

describe('schedule (integration)', () => {
  beforeEach(reset);

  it('monthlyCommitments combines subscriptions (out) + manual (signed)', async () => {
    // $10/mo subscription (outflow)
    await prisma.subscription.create({ data: { merchant: 'Netflix', amount: 10, cadence: 'monthly', cadenceDays: 30, status: 'active', firstSeen: new Date(), lastSeen: new Date(), confidence: 1 } });
    // manual: +3000/mo paycheck, −1500/mo rent
    await prisma.schedule.create({ data: { name: 'Paycheck', amount: 3000, cadenceDays: 30, nextDate: new Date() } });
    await prisma.schedule.create({ data: { name: 'Rent', amount: -1500, cadenceDays: 30, nextDate: new Date() } });

    const c = await monthlyCommitments();
    expect(c.recurringIn).toBe(3000);
    expect(c.recurringOut).toBe(1510);   // 1500 rent + 10 netflix
    expect(c.net).toBe(1490);
    expect(c.subscriptionCount).toBe(1);
    expect(c.manualCount).toBe(2);
  });

  it('upcomingEvents projects future occurrences chronologically, signed', async () => {
    const soon = new Date(Date.now() + 3 * 86400000);
    await prisma.schedule.create({ data: { name: 'Weekly allowance', amount: 50, cadenceDays: 7, nextDate: soon } });
    await prisma.subscription.create({ data: { merchant: 'Spotify', amount: 12, cadence: 'monthly', cadenceDays: 30, status: 'active', nextEstimate: soon, firstSeen: new Date(), lastSeen: new Date(), confidence: 1 } });

    const ev = await upcomingEvents(30);
    expect(ev.length).toBeGreaterThan(0);
    // chronological
    for (let i = 1; i < ev.length; i++) expect(ev[i].date >= ev[i - 1].date).toBe(true);
    // subscription is an outflow (negative), manual income is positive
    const spot = ev.find(e => e.name === 'Spotify');
    const allow = ev.find(e => e.name === 'Weekly allowance');
    expect(spot!.amount).toBeLessThan(0);
    expect(allow!.amount).toBe(50);
    // weekly over 30 days → ~4 occurrences
    expect(ev.filter(e => e.name === 'Weekly allowance').length).toBeGreaterThanOrEqual(3);
  });
});
