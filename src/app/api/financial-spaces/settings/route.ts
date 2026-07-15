import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getHouseholdSettingsView } from '@/lib/financialSpaces';

export const runtime = 'nodejs';

// Read model for the Settings household hub. Mutations go through the
// consolidated /api/financial-spaces POST actions, which validate ownership
// per explicit spaceId and are not bound to the active space.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await getHouseholdSettingsView((session.user as { id: string }).id));
  } catch (error) {
    console.error('financial-spaces/settings:', error);
    return NextResponse.json({ error: 'Could not load household settings' }, { status: 500 });
  }
}
