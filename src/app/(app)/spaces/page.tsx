import { auth } from '@/lib/auth';
import { getFinancialWorkspace } from '@/lib/financialSpaces';
import SpacesClient from './SpacesClient';

export const dynamic = 'force-dynamic';

export default async function SpacesPage() {
  const session = await auth();
  // The parent layout owns the auth redirect. App Router can begin rendering
  // this child concurrently, so avoid dereferencing a session during that race.
  if (!session?.user) return null;
  const userId = (session.user as { id: string }).id;
  const workspace = await getFinancialWorkspace(userId);
  return <SpacesClient initial={workspace as any} />;
}
