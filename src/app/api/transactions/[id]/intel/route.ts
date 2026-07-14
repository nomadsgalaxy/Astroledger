import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { transactionIntel } from '@/lib/entityIntel';

export const runtime = 'nodejs';

// GET /api/transactions/:id/intel
// Returns the same payload as the MCP `transaction_intel` tool - full row +
// account + linked subscription + email receipts + merchant history + same-
// amount neighbors. Used by the global TransactionDetailModal so any page in
// the app can open a transaction with one URL push.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const intel = await transactionIntel(id);
    return NextResponse.json(intel);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 404 });
  }
}
