import { prisma } from './prisma';
import { resolvedKind } from './accountKind';
import { healthBadge } from './syncHealth';

export type ReadinessState = 'complete' | 'attention' | 'next';

export type ReadinessStep = {
  key: 'connect' | 'current' | 'organize' | 'guardrails' | 'plan';
  title: string;
  detail: string;
  href: string;
  action: string;
  state: ReadinessState;
};

export type FinancialInboxItem = {
  key: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  tone: 'error' | 'warning' | 'info';
  count: number;
};

export type DataReadinessMetrics = {
  institutionCount: number;
  liveSourceCount: number;
  healthyLiveSourceCount: number;
  sourceErrorCount: number;
  sourceWarningCount: number;
  sourceNeverCount: number;
  accountCount: number;
  transactionCount: number;
  latestTransactionAt: Date | null;
  unorganizedTransactionCount: number;
  overdueAnticipatedCount: number;
  reviewSubscriptionCount: number;
  stalePendingCount: number;
  debtMissingInputsCount: number;
  budgetCount: number;
  spendingAlertCount: number;
  scheduleCount: number;
  goalCount: number;
  activePlanCount: number;
  forecastCount: number;
};

export type DataReadiness = {
  metrics: DataReadinessMetrics;
  steps: ReadinessStep[];
  inbox: FinancialInboxItem[];
  completedSteps: number;
  score: number;
};

const LIVE_SOURCES = new Set(['plaid', 'simplefin', 'paypal']);
const DAY = 86400000;

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

function isoDay(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : 'never';
}

export function deriveDataReadiness(metrics: DataReadinessMetrics, now = new Date()): DataReadiness {
  const hasData = metrics.accountCount > 0 && metrics.transactionCount > 0;
  const recentFileData = !!metrics.latestTransactionAt
    && now.getTime() - metrics.latestTransactionAt.getTime() <= 45 * DAY;
  const organizedRatio = metrics.transactionCount > 0
    ? metrics.unorganizedTransactionCount / metrics.transactionCount
    : 1;
  const sourceIssues = metrics.sourceErrorCount + metrics.sourceWarningCount;
  const hasGuardrails = metrics.budgetCount + metrics.spendingAlertCount > 0;

  const currentState: ReadinessState = metrics.liveSourceCount > 0
    ? sourceIssues > 0 || metrics.sourceNeverCount > 0 ? 'attention' : 'complete'
    : recentFileData ? 'complete' : hasData ? 'attention' : 'next';

  const steps: ReadinessStep[] = [
    {
      key: 'connect',
      title: 'Build the ledger',
      detail: hasData
        ? `${plural(metrics.accountCount, 'account')} · ${plural(metrics.transactionCount, 'transaction')}`
        : 'Connect an account or import financial history.',
      href: '#sources',
      action: hasData ? 'Add another source' : 'Choose a source',
      state: hasData ? 'complete' : 'next',
    },
    {
      key: 'current',
      title: 'Keep it current',
      detail: metrics.liveSourceCount > 0
        ? sourceIssues > 0
          ? `${plural(sourceIssues, 'connection')} need attention.`
          : metrics.sourceNeverCount > 0
            ? `${plural(metrics.sourceNeverCount, 'connection')} have not synced yet.`
            : `${plural(metrics.healthyLiveSourceCount, 'live source')} healthy.`
        : recentFileData
          ? `Latest imported activity is ${isoDay(metrics.latestTransactionAt)}.`
          : hasData
            ? `Latest activity is ${isoDay(metrics.latestTransactionAt)}; import a newer file or add live sync.`
            : 'Freshness can be checked after the first import.',
      href: metrics.liveSourceCount > 0 ? '#connections' : '#sources',
      action: metrics.liveSourceCount > 0 ? 'Review connections' : 'Add current data',
      state: currentState,
    },
    {
      key: 'organize',
      title: 'Trust the categories',
      detail: !hasData
        ? 'Organization starts after transactions arrive.'
        : metrics.unorganizedTransactionCount === 0
          ? 'Every spending transaction has a category or tag.'
          : `${plural(metrics.unorganizedTransactionCount, 'transaction')} still need organization.` ,
      href: '/transactions?review=unorganized',
      action: 'Review transactions',
      state: !hasData ? 'next' : organizedRatio <= 0.05 ? 'complete' : 'attention',
    },
    {
      key: 'guardrails',
      title: 'Set guardrails',
      detail: hasGuardrails
        ? `${plural(metrics.budgetCount, 'budget')} · ${plural(metrics.spendingAlertCount, 'spending alert')}`
        : 'Add a budget or spending alert for the categories that matter.',
      href: hasGuardrails ? '/alerts' : '/budgets',
      action: hasGuardrails ? 'Review guardrails' : 'Create a budget',
      state: hasGuardrails ? 'complete' : 'next',
    },
    {
      key: 'plan',
      title: 'Plan ahead',
      detail: metrics.scheduleCount + metrics.goalCount + metrics.activePlanCount + metrics.forecastCount > 0
        ? `${plural(metrics.scheduleCount, 'recurring item')} · ${plural(metrics.goalCount, 'goal')} · ${plural(metrics.activePlanCount, 'active plan')}`
        : 'Add recurring income and bills, then generate a forecast or goal.',
      href: '/forecast',
      action: 'Open Foresight',
      state: metrics.scheduleCount + metrics.goalCount + metrics.activePlanCount + metrics.forecastCount > 0 ? 'complete' : 'next',
    },
  ];

  const inbox: FinancialInboxItem[] = [];
  if (sourceIssues > 0 || metrics.sourceNeverCount > 0) {
    const count = sourceIssues + metrics.sourceNeverCount;
    inbox.push({
      key: 'sources',
      title: sourceIssues > 0 ? 'Connections need attention' : 'Connections have not synced',
      detail: sourceIssues > 0
        ? `${plural(sourceIssues, 'live connection')} ${sourceIssues === 1 ? 'is' : 'are'} stale or reporting an error.`
        : `${plural(metrics.sourceNeverCount, 'live connection')} ${metrics.sourceNeverCount === 1 ? 'needs its' : 'need their'} first refresh.`,
      href: '/connect#connections', action: 'Review sources', count,
      tone: metrics.sourceErrorCount > 0 ? 'error' : 'warning',
    });
  }
  if (metrics.unorganizedTransactionCount > 0) {
    inbox.push({
      key: 'unorganized', title: 'Transactions need organization',
      detail: `${plural(metrics.unorganizedTransactionCount, 'spending transaction')} ${metrics.unorganizedTransactionCount === 1 ? 'has' : 'have'} neither a category nor a tag.`,
      href: '/transactions?review=unorganized', action: 'Organize activity',
      count: metrics.unorganizedTransactionCount, tone: 'warning',
    });
  }
  if (metrics.overdueAnticipatedCount > 0) {
    inbox.push({
      key: 'anticipated', title: 'Expected transactions are overdue',
      detail: `${plural(metrics.overdueAnticipatedCount, 'anticipated transaction')} ${metrics.overdueAnticipatedCount === 1 ? 'is' : 'are'} dated in the past and ${metrics.overdueAnticipatedCount === 1 ? 'has' : 'have'} not been matched or removed.`,
      href: '/transactions?review=anticipated', action: 'Resolve expected items',
      count: metrics.overdueAnticipatedCount, tone: 'warning',
    });
  }
  if (metrics.stalePendingCount > 0) {
    inbox.push({
      key: 'pending', title: 'Pending transactions look stale',
      detail: `${plural(metrics.stalePendingCount, 'pending transaction')} ${metrics.stalePendingCount === 1 ? 'is' : 'are'} more than seven days old.`,
      href: '/transactions?review=pending', action: 'Review pending items',
      count: metrics.stalePendingCount, tone: 'info',
    });
  }
  if (metrics.reviewSubscriptionCount > 0) {
    inbox.push({
      key: 'subscriptions', title: 'Recurring charges need a decision',
      detail: `${plural(metrics.reviewSubscriptionCount, 'subscription')} ${metrics.reviewSubscriptionCount === 1 ? 'is' : 'are'} waiting for confirmation.`,
      href: '/subscriptions', action: 'Review subscriptions',
      count: metrics.reviewSubscriptionCount, tone: 'info',
    });
  }
  if (metrics.debtMissingInputsCount > 0) {
    inbox.push({
      key: 'debt', title: 'Debt plans need account details',
      detail: `${plural(metrics.debtMissingInputsCount, 'debt account')} ${metrics.debtMissingInputsCount === 1 ? 'is' : 'are'} missing an APR or minimum payment.`,
      href: '/debt', action: 'Complete debt setup',
      count: metrics.debtMissingInputsCount, tone: 'info',
    });
  }

  const completedSteps = steps.filter(step => step.state === 'complete').length;
  return {
    metrics, steps, inbox, completedSteps,
    score: Math.round((completedSteps / steps.length) * 100),
  };
}

export async function getDataReadiness(now = new Date()): Promise<DataReadiness> {
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY);
  const [
    institutions, accountCount, transactionCount, latestTransaction,
    unorganizedTransactionCount, overdueAnticipatedCount, reviewSubscriptionCount,
    stalePendingCount, debtAccounts, budgetCount, spendingAlertCount,
    scheduleCount, goalCount, activePlanCount, forecastCount,
  ] = await Promise.all([
    prisma.institution.findMany({
      select: {
        source: true, accessToken: true, lastSyncedAt: true,
        lastSyncStatus: true, lastSyncError: true,
      },
    }),
    prisma.bankAccount.count(),
    prisma.transaction.count(),
    prisma.transaction.aggregate({ _max: { date: true } }),
    prisma.transaction.count({
      where: {
        amount: { lt: 0 }, isTransfer: false, isAnticipated: false,
        parentTransactionId: null, isSplit: false, categoryId: null,
        tags: { none: {} },
      },
    }),
    prisma.transaction.count({ where: { isAnticipated: true, date: { lt: now } } }),
    prisma.subscription.count({ where: { status: 'review' } }),
    prisma.transaction.count({ where: { pending: true, date: { lt: sevenDaysAgo } } }),
    prisma.bankAccount.findMany({
      select: {
        kind: true, type: true, subtype: true, balance: true,
        apr: true, minimumPayment: true,
      },
    }),
    prisma.budget.count(),
    prisma.spendingAlert.count({ where: { enabled: true } }),
    prisma.schedule.count({ where: { active: true } }),
    prisma.goal.count({ where: { status: 'active' } }),
    prisma.plan.count({ where: { status: 'active' } }),
    prisma.forecast.count(),
  ]);

  const liveHealth = institutions
    .filter(inst => LIVE_SOURCES.has(inst.source))
    .map(inst => healthBadge(inst));
  const debtMissingInputsCount = debtAccounts.filter(account => {
    const kind = resolvedKind(account);
    return (kind === 'credit' || kind === 'loan')
      && Math.abs(account.balance ?? 0) > 0.005
      && (account.apr == null || account.minimumPayment == null);
  }).length;

  return deriveDataReadiness({
    institutionCount: institutions.length,
    liveSourceCount: liveHealth.length,
    healthyLiveSourceCount: liveHealth.filter(item => item.tone === 'success').length,
    sourceErrorCount: liveHealth.filter(item => item.tone === 'error').length,
    sourceWarningCount: liveHealth.filter(item => item.tone === 'warning').length,
    sourceNeverCount: liveHealth.filter(item => item.tone === 'info').length,
    accountCount,
    transactionCount,
    latestTransactionAt: latestTransaction._max.date,
    unorganizedTransactionCount,
    overdueAnticipatedCount,
    reviewSubscriptionCount,
    stalePendingCount,
    debtMissingInputsCount,
    budgetCount,
    spendingAlertCount,
    scheduleCount,
    goalCount,
    activePlanCount,
    forecastCount,
  }, now);
}
