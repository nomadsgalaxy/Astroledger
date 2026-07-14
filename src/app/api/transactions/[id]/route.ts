import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.notes === 'string' || body.notes === null) data.notes = body.notes || null;
  if (typeof body.merchant === 'string') data.merchant = body.merchant.trim();
  if (typeof body.isTransfer === 'boolean') data.isTransfer = body.isTransfer;
  // Statement-reconciliation flag. Toggled from the reconcile workflow (and
  // available in the tx list). We never let this PATCH stamp reconciledAt —
  // that's reserved for the lock step so an un-clear can't orphan a lock. But
  // un-clearing a row that was already locked must also clear reconciledAt,
  // otherwise the cleared-balance math would double-count it.
  if (typeof body.cleared === 'boolean') {
    data.cleared = body.cleared;
    if (body.cleared === false) data.reconciledAt = null;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
  try {
    await prisma.transaction.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

// DELETE /api/transactions/:id - drop a single transaction. Cascades to
// receipts via the Receipt.onDelete relation. Used for cleaning up duplicates
// where two sources (e.g. SimpleFIN + QIF) brought in the same charge.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    await prisma.transaction.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
