import { describe, it, expect, beforeEach } from 'vitest';
import { reset, prisma, makeAccount, makeInstitution, makeTx } from './_fixtures';
import { getBillDashboard, projectOccurrenceDates } from '../../src/lib/bills';

describe('bill lifecycle (integration)', () => {
  beforeEach(reset);

  it('projects recurring obligations and automatically links a strong payment match', async () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    const institution = await makeInstitution();
    const account = await makeAccount(institution.id);
    await prisma.subscription.create({
      data: { merchant: 'Stream Box', amount: 15, cadence: 'monthly', cadenceDays: 30, status: 'active', nextEstimate: new Date('2026-07-20'), firstSeen: now, lastSeen: now, confidence: 1 },
    });
    await prisma.schedule.create({
      data: { name: 'Electric Utility', amount: -120, amountMode: 'variable', cadenceDays: 30, nextDate: new Date('2026-07-10') },
    });
    const payment = await makeTx(account.id, -118.42, { date: new Date('2026-07-10'), merchant: 'Electric Utility', rawDescription: 'ELECTRIC UTILITY AUTOPAY' });

    const dashboard = await getBillDashboard(now, 60, 10);
    const utility = dashboard.occurrences.find(item => item.name === 'Electric Utility' && item.dueDate === '2026-07-10');
    expect(utility?.status).toBe('paid');
    expect(utility?.transaction?.id).toBe(payment.id);
    expect(dashboard.occurrences.filter(item => item.name === 'Stream Box')).toHaveLength(1);
  });

  it('keeps an occurrence override without changing later occurrences', async () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    await prisma.schedule.create({ data: { name: 'Rent', amount: -1500, cadenceDays: 30, nextDate: new Date('2026-07-20') } });
    const first = await getBillDashboard(now, 60, 5);
    const occurrences = first.occurrences.filter(item => item.name === 'Rent');
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    await prisma.billOccurrence.update({ where: { id: occurrences[0].id }, data: { status: 'skipped', expectedAmount: 1400 } });

    const second = await getBillDashboard(now, 60, 5);
    const refreshed = second.occurrences.filter(item => item.name === 'Rent');
    expect(refreshed[0].status).toBe('skipped');
    expect(refreshed[0].expectedAmount).toBe(1400);
    expect(refreshed[1].expectedAmount).toBe(1500);
  });

  it('projects occurrence dates deterministically', () => {
    const dates = projectOccurrenceDates(new Date('2026-07-01'), 14, new Date('2026-07-10'), new Date('2026-08-15'));
    expect(dates.map(date => date.toISOString().slice(0, 10))).toEqual(['2026-07-15', '2026-07-29', '2026-08-12']);
  });
});
