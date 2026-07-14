import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getRequestFinancialAccess } from '@/lib/prisma';
import {
  AllowanceError, claimChore, createChore, decideAllowancePayout, decideChore,
  deleteAllowanceRule, deleteChore, getAllowanceOverview, upsertAllowanceRule,
} from '@/lib/allowances';

export const runtime = 'nodejs';

function failure(error: unknown) {
  if (error instanceof AllowanceError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('allowances:', error);
  return NextResponse.json({ error: 'Could not update allowances' }, { status: 500 });
}

async function requireAccess() {
  const session = await auth();
  if (!session?.user) return null;
  return getRequestFinancialAccess();
}

export async function GET() {
  const access = await requireAccess();
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await getAllowanceOverview(access)); }
  catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  const access = await requireAccess();
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Record<string, any>;
  try {
    switch (body.action) {
      case 'save_rule':
        await upsertAllowanceRule(access, {
          id: body.id, name: String(body.name ?? ''), amount: Number(body.amount),
          cadenceDays: Number(body.cadenceDays), nextDate: String(body.nextDate ?? ''),
          accountId: String(body.accountId ?? ''), autoApprove: body.autoApprove,
          active: body.active, notes: body.notes,
        });
        break;
      case 'delete_rule':
        await deleteAllowanceRule(access, String(body.ruleId));
        break;
      case 'decide_payout':
        await decideAllowancePayout(access, String(body.payoutId), body.decision === 'reject' ? 'reject' : 'approve');
        break;
      case 'create_chore':
        await createChore(access, {
          name: String(body.name ?? ''), reward: Number(body.reward),
          assigneeUserId: body.assigneeUserId, accountId: body.accountId, notes: body.notes,
        });
        break;
      case 'claim_chore':
        await claimChore(access, String(body.choreId));
        break;
      case 'decide_chore':
        await decideChore(access, String(body.choreId), body.decision === 'reject' ? 'reject' : 'approve', body.accountId);
        break;
      case 'delete_chore':
        await deleteChore(access, String(body.choreId));
        break;
      default:
        throw new AllowanceError('Unknown action');
    }
    return NextResponse.json(await getAllowanceOverview(access));
  } catch (error) { return failure(error); }
}
