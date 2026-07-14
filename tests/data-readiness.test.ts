import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import { deriveDataReadiness, type DataReadinessMetrics } from '../src/lib/dataReadiness';

const NOW = new Date('2026-07-14T12:00:00.000Z');

function metrics(overrides: Partial<DataReadinessMetrics> = {}): DataReadinessMetrics {
  return {
    institutionCount: 0,
    liveSourceCount: 0,
    healthyLiveSourceCount: 0,
    sourceErrorCount: 0,
    sourceWarningCount: 0,
    sourceNeverCount: 0,
    accountCount: 0,
    transactionCount: 0,
    latestTransactionAt: null,
    unorganizedTransactionCount: 0,
    overdueAnticipatedCount: 0,
    reviewSubscriptionCount: 0,
    stalePendingCount: 0,
    debtMissingInputsCount: 0,
    budgetCount: 0,
    spendingAlertCount: 0,
    scheduleCount: 0,
    goalCount: 0,
    activePlanCount: 0,
    forecastCount: 0,
    ...overrides,
  };
}

describe('deriveDataReadiness', () => {
  it('gives a complete score to a healthy, organized, planned ledger', () => {
    const result = deriveDataReadiness(metrics({
      institutionCount: 1, liveSourceCount: 1, healthyLiveSourceCount: 1,
      accountCount: 2, transactionCount: 100, latestTransactionAt: NOW,
      unorganizedTransactionCount: 2, budgetCount: 2, scheduleCount: 1,
    }), NOW);
    expect(result.score).toBe(100);
    expect(result.completedSteps).toBe(5);
    expect(result.inbox[0]?.key).toBe('unorganized');
  });

  it('marks stale file-only data as attention instead of demanding a live connector', () => {
    const result = deriveDataReadiness(metrics({
      institutionCount: 1, accountCount: 1, transactionCount: 10,
      latestTransactionAt: new Date('2026-01-01T00:00:00.000Z'),
    }), NOW);
    expect(result.steps.find(step => step.key === 'current')?.state).toBe('attention');
  });

  it('treats a small unorganized tail as complete but still puts it in the inbox', () => {
    const result = deriveDataReadiness(metrics({
      accountCount: 1, transactionCount: 100, latestTransactionAt: NOW,
      unorganizedTransactionCount: 5,
    }), NOW);
    expect(result.steps.find(step => step.key === 'organize')?.state).toBe('complete');
    expect(result.inbox.some(item => item.key === 'unorganized')).toBe(true);
  });

  it('orders hard source errors before other review work', () => {
    const result = deriveDataReadiness(metrics({
      liveSourceCount: 2, sourceErrorCount: 1, sourceWarningCount: 1,
      accountCount: 1, transactionCount: 20, latestTransactionAt: NOW,
      unorganizedTransactionCount: 10, overdueAnticipatedCount: 2,
      debtMissingInputsCount: 1,
    }), NOW);
    expect(result.inbox[0]).toMatchObject({ key: 'sources', tone: 'error', count: 2 });
    expect(result.inbox.map(item => item.key)).toEqual(['sources', 'unorganized', 'anticipated', 'debt']);
  });
});
