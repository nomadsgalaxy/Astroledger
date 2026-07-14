// GET   /api/household → the current user's household + members
// PATCH /api/household → rename the household { name }
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getHousehold, HouseholdError, renameHousehold } from '@/lib/household';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ household: await getHousehold((session.user as { id: string }).id) });
  } catch (error) {
    return householdError(error);
  }
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { name?: string };
  if (!body.name || !body.name.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  try {
    return NextResponse.json({ household: await renameHousehold((session.user as { id: string }).id, body.name) });
  } catch (error) {
    return householdError(error);
  }
}

function householdError(error: unknown) {
  if (error instanceof HouseholdError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: 'Could not update household' }, { status: 500 });
}
