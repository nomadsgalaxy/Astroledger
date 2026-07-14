import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { HouseholdError, revokeHouseholdInvite } from '@/lib/household';

export const runtime = 'nodejs';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ household: await revokeHouseholdInvite((session.user as { id: string }).id, id) });
  } catch (error) {
    if (error instanceof HouseholdError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Could not revoke invitation' }, { status: 500 });
  }
}
