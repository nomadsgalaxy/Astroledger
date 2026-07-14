// The (app) route group's layout enforces authentication BEFORE any child
// page renders. Because `redirect()` throws, no Prisma query and no Server
// Component body for the protected page will ever run for an unauthenticated
// request. This is the canonical guarantee that data cannot be presented
// without a verified session.

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import Shell from '../_components/Shell';
import DemoDisclaimer from '../_components/DemoDisclaimer';
import { getRange } from '@/lib/timeRange.server';
import { ensureUserFinancialSpaces } from '@/lib/financialAccess';
import { prisma } from '@/lib/prisma';
import { getFinancialSpaceSwitcher } from '@/lib/financialSpaces';

const DEMO_MODE = process.env.DEMO_MODE === 'true';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    // Demo deployments auto-re-provision the visitor's session. This is the
    // path hit when their sandbox was wiped by the hourly reset cron (or
    // GC'd after 30 min idle): the cookie is still in the browser, but the
    // Session row is gone, so auth() returns null. Bounce back through
    // /api/demo/start-session, which mints a fresh sandbox + cookie. Self-
    // hosters keep the regular sign-in flow.
    if (DEMO_MODE) {
      const h = await headers();
      const path = h.get('x-pathname') ?? '/';
      const next = encodeURIComponent(path);
      redirect(`/api/demo/start-session?next=${next}`);
    }
    redirect('/auth/signin');
  }
  try {
    await ensureUserFinancialSpaces(prisma, (session.user as { id: string }).id);
  } catch {
    redirect('/auth/access-denied');
  }
  const range = await getRange();
  const spaceSwitcher = await getFinancialSpaceSwitcher((session.user as { id: string }).id);
  const userName = (session.user.name ?? session.user.email ?? 'User').trim();
  return (
    <Shell rangeKey={range.key} userName={userName} spaceSwitcher={spaceSwitcher}>
      {children}
      {DEMO_MODE && <DemoDisclaimer />}
    </Shell>
  );
}
