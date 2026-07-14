// Plans = versioned budgets. Create from a forecast, edit, activate. Old plans
// stay queryable forever - that's how benchmarking sees plan drift over time.

import { prisma } from './prisma';

export async function createPlanFromForecast(opts: { name: string; months: number; activate?: boolean }) {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const periodEnd   = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + opts.months, 1));

  const forecasts = await prisma.forecast.findMany({
    where: { scope: 'category', method: 'composite', generatedAt: { gte: new Date(+now - 7 * 86400000) } },
    orderBy: { generatedAt: 'desc' },
    include: { points: { orderBy: { month: 'asc' } } },
  });
  // Keep only the freshest per category
  const byCat = new Map<string, typeof forecasts[number]>();
  for (const f of forecasts) if (!byCat.has(f.scopeKey!)) byCat.set(f.scopeKey!, f);

  if (byCat.size === 0) throw new Error('No fresh forecast found. Run /forecast first.');

  const plan = await prisma.plan.create({
    data: { name: opts.name, periodStart, periodEnd, source: 'forecast', status: 'draft' },
  });

  for (const [cat, fc] of byCat) {
    for (const p of fc.points.slice(0, opts.months)) {
      await prisma.planLine.create({
        data: {
          planId: plan.id, scope: 'category', scopeKey: cat,
          month: p.month, amount: p.point, flow: 'outflow',
          sourceMethod: 'forecast:composite',
        },
      });
    }
  }

  if (opts.activate) await activatePlan(plan.id);
  return plan;
}

export async function activatePlan(planId: string) {
  const target = await prisma.plan.findUnique({ where: { id: planId } });
  if (!target) throw new Error('Plan not found');
  // Mark overlapping active plans as superseded
  const overlapping = await prisma.plan.findMany({
    where: {
      id: { not: planId }, status: 'active',
      periodStart: { lt: target.periodEnd }, periodEnd: { gt: target.periodStart },
    },
  });
  for (const p of overlapping) {
    await prisma.plan.update({
      where: { id: p.id },
      data: { status: 'superseded', supersededBy: planId, supersededAt: new Date() },
    });
  }
  return prisma.plan.update({
    where: { id: planId },
    data: { status: 'active', activatedAt: new Date() },
  });
}

export async function archivePlan(planId: string) {
  return prisma.plan.update({ where: { id: planId }, data: { status: 'archived' } });
}

export async function getActivePlan() {
  return prisma.plan.findFirst({
    where: { status: 'active' },
    include: { lines: true },
    orderBy: { activatedAt: 'desc' },
  });
}
