import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getRequestFinancialAccess } from '@/lib/prisma';
import {
  SharedExpenseError, createSharedExpense, deleteSharedExpense, listSettleCandidates,
  listSharedExpenses, listSplitCandidates, reopenExpenseShare, settleExpenseShare,
} from '@/lib/sharedExpenses';

export const runtime = 'nodejs';

function failure(error: unknown) {
  if (error instanceof SharedExpenseError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('shared-expenses:', error);
  return NextResponse.json({ error: 'Could not update shared expenses' }, { status: 500 });
}

async function requireAccess() {
  const session = await auth();
  if (!session?.user) return null;
  return getRequestFinancialAccess();
}

export async function GET() {
  const access = await requireAccess();
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const [list, candidates, settleCandidates] = await Promise.all([
      listSharedExpenses(access), listSplitCandidates(access), listSettleCandidates(access),
    ]);
    return NextResponse.json({ ...list, candidates, settleCandidates });
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  const access = await requireAccess();
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Record<string, any>;
  try {
    switch (body.action) {
      case 'create':
        await createSharedExpense(access, {
          transactionId: String(body.transactionId ?? ''), splitMode: body.splitMode,
          shares: Array.isArray(body.shares) ? body.shares : [], notes: body.notes, paidById: body.paidById,
        });
        break;
      case 'settle':
        await settleExpenseShare(access, String(body.shareId), { settlementTransactionId: body.settlementTransactionId });
        break;
      case 'reopen':
        await reopenExpenseShare(access, String(body.shareId));
        break;
      case 'delete':
        await deleteSharedExpense(access, String(body.expenseId));
        break;
      default:
        throw new SharedExpenseError('Unknown action');
    }
    const [list, candidates, settleCandidates] = await Promise.all([
      listSharedExpenses(access), listSplitCandidates(access), listSettleCandidates(access),
    ]);
    return NextResponse.json({ ...list, candidates, settleCandidates });
  } catch (error) { return failure(error); }
}
