// Update checker against the public GitHub releases feed. Read-only: it
// compares the running version with the latest published release and caches
// the answer in AppSetting so the settings page never hammers the GitHub API.
// Applying an update remains an operator action (the container cannot rebuild
// itself); the UI shows the documented upgrade path instead of pretending.
import { prisma } from './prisma';
import packageJson from '../../package.json';

const REPO = 'nomadsgalaxy/Astroledger';
const CACHE_KEY = 'update:status';
const CACHE_TTL_MS = 6 * 3600_000;

export type UpdateStatus = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  checkedAt: string;
  error: string | null;
};

export function newerThan(latest: string, current: string): boolean {
  const parse = (value: string) => value.replace(/^v/i, '').split('.').map(part => parseInt(part, 10) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function getUpdateStatus(force = false): Promise<UpdateStatus> {
  const currentVersion = packageJson.version;
  const cachedRow = await prisma.appSetting.findUnique({ where: { key: CACHE_KEY } }).catch(() => null);
  let cached: UpdateStatus | null = null;
  try { cached = cachedRow ? JSON.parse(cachedRow.value) as UpdateStatus : null; } catch { cached = null; }
  if (!force && cached && Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL_MS) {
    return { ...cached, currentVersion, updateAvailable: !!cached.latestVersion && newerThan(cached.latestVersion, currentVersion) };
  }

  let status: UpdateStatus;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'astroledger-update-check' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = await response.json() as { tag_name?: string; name?: string; body?: string; html_url?: string; published_at?: string };
    const latestVersion = (release.tag_name ?? '').replace(/^v/i, '') || null;
    status = {
      currentVersion,
      latestVersion,
      updateAvailable: !!latestVersion && newerThan(latestVersion, currentVersion),
      releaseUrl: release.html_url ?? null,
      releaseName: release.name ?? null,
      releaseNotes: release.body?.slice(0, 2000) ?? null,
      publishedAt: release.published_at ?? null,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  } catch (error: any) {
    // Keep the last good answer if there is one; report the failure otherwise.
    status = cached
      ? { ...cached, currentVersion, checkedAt: new Date().toISOString(), error: `Check failed: ${error?.message ?? error}` }
      : {
        currentVersion, latestVersion: null, updateAvailable: false, releaseUrl: null,
        releaseName: null, releaseNotes: null, publishedAt: null,
        checkedAt: new Date().toISOString(), error: `Check failed: ${error?.message ?? error}`,
      };
  }
  await prisma.appSetting.upsert({
    where: { key: CACHE_KEY },
    create: { key: CACHE_KEY, value: JSON.stringify(status) },
    update: { value: JSON.stringify(status) },
  }).catch(() => {});
  return status;
}
