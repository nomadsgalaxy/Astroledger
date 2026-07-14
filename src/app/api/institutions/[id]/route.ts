import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// DELETE /api/institutions/:id
// Query:
//   ?keepData=true  → "Disconnect": null the accessToken; accounts and
//                     transactions stay intact. Future syncs skip this row.
//   (otherwise)     → "Delete": remove the institution. Prisma cascades to
//                     BankAccount, which cascades to Transaction (+ Receipts
//                     via Transaction.onDelete cascade on the Receipt model).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const keepData = new URL(req.url).searchParams.get('keepData') === 'true';

  const inst = await prisma.institution.findUnique({
    where: { id },
    include: { _count: { select: { accounts: true } } },
  });
  if (!inst) return NextResponse.json({ error: 'Institution not found' }, { status: 404 });

  if (keepData) {
    // Disconnect: null out the access credential, keep the row.
    await prisma.institution.update({
      where: { id },
      data: { accessToken: null, plaidItemId: null },
    });
    return NextResponse.json({ ok: true, mode: 'disconnected', accountsKept: inst._count.accounts });
  }

  // Full delete. Count affected rows first so the response is informative.
  const accounts = await prisma.bankAccount.findMany({
    where: { institutionId: id },
    select: { id: true, _count: { select: { transactions: true } } },
  });
  const txCount = accounts.reduce((s, a) => s + a._count.transactions, 0);

  await prisma.institution.delete({ where: { id } });
  return NextResponse.json({
    ok: true, mode: 'deleted',
    accountsDeleted: accounts.length, transactionsDeleted: txCount,
  });
}
