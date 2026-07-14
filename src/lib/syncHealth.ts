// Connection health — records the outcome of every connector refresh on the
// Institution row (lastSyncedAt / lastSyncStatus / lastSyncError) and turns
// that raw state into a UI badge (tone + label) so /connect and /accounts can
// show at a glance whether a live source is healthy, stale, or broken.
//
// Status vocabulary (Institution.lastSyncStatus):
//   never         — connected but never refreshed yet
//   ok            — last refresh succeeded
//   auth_error    — bridge/provider rejected credentials (needs reconnect)
//   network_error — transient fetch failure (will likely recover next run)
//   error         — anything else (unexpected; surfaces the message)
//
// Why a status string + nullable error rather than booleans: it round-trips
// cleanly through the cron path (no session) and the manual path identically,
// and the message is the single most useful thing to show a self-hoster
// debugging why a bank stopped importing.

import { prisma } from './prisma';

export type SyncStatus = 'never' | 'ok' | 'auth_error' | 'network_error' | 'error';

// Classify a thrown error into a coarse status. SimpleFIN/Plaid both surface
// 401/403 as credential problems; everything network-ish (fetch/DNS/timeout)
// is treated as transient so we don't nag the user to reconnect a still-valid
// link over a blip.
export function classifySyncError(err: unknown): { status: Exclude<SyncStatus, 'ok' | 'never'>; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const low = msg.toLowerCase();
  if (/\b(401|403)\b/.test(msg) || low.includes('credential') || low.includes('unauthor') || low.includes('rejected credentials')) {
    return { status: 'auth_error', message: msg };
  }
  if (low.includes('fetch failed') || low.includes('econnrefused') || low.includes('enotfound') ||
      low.includes('etimedout') || low.includes('network') || low.includes('timeout') || low.includes('socket')) {
    return { status: 'network_error', message: msg };
  }
  return { status: 'error', message: msg };
}

// Record a successful refresh. Clears any prior error.
export async function recordSyncSuccess(institutionId: string): Promise<void> {
  await prisma.institution.update({
    where: { id: institutionId },
    data: { lastSyncedAt: new Date(), lastSyncStatus: 'ok', lastSyncError: null },
  }).catch(() => {}); // health is best-effort; never let it mask the real sync result
}

// Record a failed refresh. Does NOT touch lastSyncedAt — the badge can then
// show "last OK 3d ago, failing since" by comparing lastSyncedAt to now while
// status reflects the current failure.
export async function recordSyncError(institutionId: string, err: unknown): Promise<void> {
  const { status, message } = classifySyncError(err);
  await prisma.institution.update({
    where: { id: institutionId },
    // Truncate — a stack-trace-laden message would bloat the row and the UI.
    data: { lastSyncStatus: status, lastSyncError: message.slice(0, 500) },
  }).catch(() => {});
}

// ── Badge derivation (pure; used by server components) ───────────────────────
export type HealthTone = 'success' | 'warning' | 'error' | 'info' | 'ghost';
export type HealthBadge = { tone: HealthTone; label: string; detail: string };

// A live link is "stale" if it hasn't refreshed within this window even though
// it last succeeded — surfaced as a soft warning, distinct from a hard error.
const STALE_AFTER_DAYS = 4;

function ago(d: Date | null): string {
  if (!d) return 'never';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) {
    const hrs = Math.floor((Date.now() - d.getTime()) / 3600000);
    return hrs <= 0 ? 'just now' : `${hrs}h ago`;
  }
  return days === 1 ? '1d ago' : `${days}d ago`;
}

export function healthBadge(inst: {
  source: string;
  accessToken?: string | null;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncError?: string | null;
}): HealthBadge {
  const live = inst.source === 'plaid' || inst.source === 'simplefin' || inst.source === 'paypal';
  if (!live) return { tone: 'ghost', label: 'File import', detail: 'One-time import — no live sync.' };

  // SimpleFIN with no token is the classic "lost credentials" state.
  if (inst.source === 'simplefin' && !inst.accessToken) {
    return { tone: 'warning', label: 'Disconnected', detail: 'No access token — paste a fresh SimpleFIN setup token to reconnect.' };
  }

  const status = (inst.lastSyncStatus ?? 'never') as SyncStatus;
  const when = ago(inst.lastSyncedAt);
  switch (status) {
    case 'auth_error':
      return { tone: 'error', label: 'Auth failed', detail: `Credentials rejected. Last OK ${when}. Reconnect to resume.` };
    case 'network_error':
      return { tone: 'warning', label: 'Sync error', detail: `Transient network failure. Last OK ${when}. Will retry on next run.` };
    case 'error':
      return { tone: 'error', label: 'Sync error', detail: `${inst.lastSyncError ?? 'Unknown error'} (last OK ${when}).` };
    case 'never':
      return { tone: 'info', label: 'Not synced yet', detail: 'Connected but not refreshed yet. Click Refresh to pull transactions.' };
    case 'ok': {
      const stale = inst.lastSyncedAt
        ? (Date.now() - inst.lastSyncedAt.getTime()) > STALE_AFTER_DAYS * 86400000
        : true;
      return stale
        ? { tone: 'warning', label: `Stale · ${when}`, detail: `Last successful refresh ${when}. Older than ${STALE_AFTER_DAYS}d — refresh to catch up.` }
        : { tone: 'success', label: `Synced · ${when}`, detail: `Last successful refresh ${when}.` };
    }
    default:
      return { tone: 'ghost', label: 'Unknown', detail: '' };
  }
}
