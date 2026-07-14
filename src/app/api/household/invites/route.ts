import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { HouseholdError, inviteHouseholdMember } from '@/lib/household';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { email?: string; role?: string };
  try {
    const household = await inviteHouseholdMember(
      (session.user as { id: string }).id,
      body.email ?? '',
      body.role === 'owner' ? 'owner' : 'member',
    );
    return NextResponse.json({ household }, { status: 201 });
  } catch (error) {
    if (error instanceof HouseholdError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Could not create invitation' }, { status: 500 });
  }
}
