import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { HouseholdError, removeHouseholdMember, updateHouseholdMemberRole } from '@/lib/household';

export const runtime = 'nodejs';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { role?: string };
  if (!['owner', 'member'].includes(body.role ?? '')) return NextResponse.json({ error: 'role must be owner or member' }, { status: 400 });
  try {
    return NextResponse.json({ household: await updateHouseholdMemberRole((session.user as { id: string }).id, id, body.role as 'owner' | 'member') });
  } catch (error) {
    return householdError(error);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ household: await removeHouseholdMember((session.user as { id: string }).id, id) });
  } catch (error) {
    return householdError(error);
  }
}

function householdError(error: unknown) {
  if (error instanceof HouseholdError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: 'Could not update member' }, { status: 500 });
}
