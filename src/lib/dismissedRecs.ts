import { prisma } from './prisma';
import { activeFinancialSpaceId } from './spaceContext';

const DISMISS_TTL_KEY = 'dismiss_ttl_days';
const DEFAULT_TTL_DAYS = 12;
const MIN_TTL = 1;
const MAX_TTL = 365;

/** Read the user-configured TTL for dismissed recommendations.
 *  Default 12 days. Clamped to [1, 365]. */
export async function getDismissTtlDays(): Promise<number> {
  const scopedKey = `space:${await activeFinancialSpaceId()}:${DISMISS_TTL_KEY}`;
  const row = await prisma.appSetting.findUnique({ where: { key: scopedKey } })
    ?? await prisma.appSetting.findUnique({ where: { key: DISMISS_TTL_KEY } });
  const raw = row?.value ? Number(row.value) : DEFAULT_TTL_DAYS;
  if (!Number.isFinite(raw)) return DEFAULT_TTL_DAYS;
  return Math.max(MIN_TTL, Math.min(MAX_TTL, Math.round(raw)));
}

/** Update the TTL setting. Returns the value actually stored after clamping. */
export async function setDismissTtlDays(days: number): Promise<number> {
  if (!Number.isFinite(days)) throw new Error('days must be a finite number');
  const clamped = Math.max(MIN_TTL, Math.min(MAX_TTL, Math.round(days)));
  const key = `space:${await activeFinancialSpaceId()}:${DISMISS_TTL_KEY}`;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: String(clamped) },
    update: { value: String(clamped) },
  });
  return clamped;
}

/** Delete dismissed recommendations older than the configured TTL. Idempotent;
 *  cheap (one DELETE with a where-clause). Called on /alerts page load so the
 *  cleanup happens passively without a cron. */
export async function expireOldDismissedRecs(): Promise<{ deleted: number; ttlDays: number }> {
  const ttlDays = await getDismissTtlDays();
  const cutoff = new Date(Date.now() - ttlDays * 86400_000);
  const result = await prisma.recommendation.deleteMany({
    where: {
      status: 'dismissed',
      dismissedAt: { lt: cutoff },
    },
  });
  return { deleted: result.count, ttlDays };
}

/** Days remaining before a dismissed rec auto-deletes. Returns null if not
 *  dismissed or already past expiry. */
export function daysUntilExpiry(dismissedAt: Date | null | undefined, ttlDays: number): number | null {
  if (!dismissedAt) return null;
  const expiresAt = dismissedAt.getTime() + ttlDays * 86400_000;
  const left = Math.ceil((expiresAt - Date.now()) / 86400_000);
  return left > 0 ? left : 0;
}
