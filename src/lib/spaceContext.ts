import { prisma, getRequestFinancialAccess } from './prisma';

/** Active space for request work; trusted background tasks fall back to the
 * oldest shared space so their idempotency keys remain space-aware. */
export async function activeFinancialSpaceId(): Promise<string> {
  const request = await getRequestFinancialAccess();
  if (request) return request.activeSpaceId;
  const fallback = await prisma.financialSpace.findFirst({
    where: { status: { not: 'archived' }, kind: 'household' },
    orderBy: { createdAt: 'asc' }, select: { id: true },
  }) ?? await prisma.financialSpace.findFirst({
    where: { status: { not: 'archived' } }, orderBy: { createdAt: 'asc' }, select: { id: true },
  });
  if (fallback) return fallback.id;
  const system = await prisma.financialSpace.upsert({
    where: { id: 'space_system_default' }, update: {},
    create: { id: 'space_system_default', name: 'System Finances', kind: 'household', createdById: 'system' },
    select: { id: true },
  });
  return system.id;
}
