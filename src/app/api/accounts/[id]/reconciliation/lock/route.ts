// POST /api/accounts/:id/reconciliation/lock
//
// Finalize a reconciliation: stamp reconciledAt on every currently-cleared,
// not-yet-locked transaction and record reconciledAsOf on the account.
//
// Body:
//   statementBalance: number          // the bank statement's ending balance
//   statementDate?:   string (ISO)    // statement closing date; default now
//   createAdjustment?: boolean        // if it doesn't tie out, create a single
//                                      // balancing "Reconciliation adjustment"
//                                      // row for the residual, then lock
//
// Refuses (409) if the cleared balance doesn't equal the statement balance and
// createAdjustment isn't set — locking a mismatched account would bake an error
// into the audit trail. With createAdjustment, the residual becomes an explicit,
// visible transaction (Quicken's opening-balance trick) so the books stay honest.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getReconcileState, reconcileDifference, tiesOut } from '@/lib/reconciliation';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => ({})) as {
    statementBalance?: number; statementDate?: string; createAdjustment?: boolean;
  };
  if (typeof body.statementBalance !== 'number' || !Number.isFinite(body.statementBalance)) {
    return NextResponse.json({ error: 'statementBalance (number) is required' }, { status: 400 });
  }
  const statementDate = body.statementDate ? new Date(body.statementDate) : new Date();
  if (isNaN(statementDate.getTime())) {
    return NextResponse.json({ error: 'statementDate is not a valid date' }, { status: 400 });
  }

  const state = await getReconcileState(id);
  if (!state) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  let diff = reconcileDifference(body.statementBalance, state.clearedBalance);
  let adjustmentId: string | null = null;

  if (!tiesOut(diff)) {
    if (!body.createAdjustment) {
      return NextResponse.json({
        error: 'Cleared balance does not match the statement balance.',
        code: 'OUT_OF_BALANCE',
        difference: diff,
        clearedBalance: state.clearedBalance,
        statementBalance: body.statementBalance,
      }, { status: 409 });
    }
    // Create one balancing row for the residual. amount = diff so that the new
    // cleared balance equals the statement balance exactly. Marked cleared so it
    // gets locked in the same pass below. Deterministic hash → a retry with the
    // same account+date+residual collides on the @unique hash instead of
    // double-booking; if it already exists, reuse it (idempotent).
    const adjHash = `reconcile-adj-${id}-${statementDate.toISOString().slice(0, 10)}-${diff.toFixed(2)}`;
    try {
      const adj = await prisma.transaction.create({
        data: {
          accountId: id,
          hash: adjHash,
          date: statementDate,
          amount: diff,
          rawDescription: 'Reconciliation adjustment',
          merchant: 'Reconciliation adjustment',
          cleared: true,
          notes: `Balancing entry created during reconciliation to ${body.statementBalance.toFixed(2)} on ${statementDate.toISOString().slice(0, 10)}.`,
        },
        select: { id: true },
      });
      adjustmentId = adj.id;
    } catch (e: any) {
      if (String(e?.code) === 'P2002' || String(e?.message ?? '').includes('Unique constraint')) {
        const prior = await prisma.transaction.findUnique({ where: { hash: adjHash }, select: { id: true } });
        adjustmentId = prior?.id ?? null;
      } else throw e;
    }
    // Re-verify tie-out before locking. A fresh adjustment balances by
    // construction; a P2002 hash collision (a different reconciliation whose
    // residual coincidentally matched this date+amount) booked no new row, so
    // refuse to lock a still-unbalanced account.
    const after = await getReconcileState(id);
    const afterDiff = after ? reconcileDifference(body.statementBalance, after.clearedBalance) : diff;
    if (!tiesOut(afterDiff)) {
      return NextResponse.json({
        error: 'A reconciliation adjustment for this date and amount already exists but does not balance the current cleared total.',
        code: 'OUT_OF_BALANCE',
        difference: afterDiff,
        clearedBalance: after?.clearedBalance,
        statementBalance: body.statementBalance,
      }, { status: 409 });
    }
    diff = 0;
  }

  // Lock + record as-of atomically. Scope the lock to bank-statement lines
  // (parents + unsplit rows; exclude split children) so we never lock an
  // internal split child.
  const now = new Date();
  const locked = await prisma.$transaction(async tx => {
    const result = await tx.transaction.updateMany({
      where: { accountId: id, parentTransactionId: null, cleared: true, reconciledAt: null },
      data: { reconciledAt: now },
    });
    await tx.bankAccount.update({
      where: { id },
      data: { reconciledAsOf: statementDate },
    });
    return result;
  });

  return NextResponse.json({
    ok: true,
    lockedCount: locked.count,
    reconciledAsOf: statementDate.toISOString(),
    adjustmentId,
    statementBalance: body.statementBalance,
  });
}
