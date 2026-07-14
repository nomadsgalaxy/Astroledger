import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { splitTransaction, unsplitTransaction } from '@/lib/splits';

export const runtime = 'nodejs';

// POST /api/transactions/:id/split
// Body: { splits: [{ amount, merchant?, categoryName?, tagIds?, notes? }, ...] }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.splits)) {
    return NextResponse.json({ error: 'splits array required' }, { status: 400 });
  }
  try {
    const result = await splitTransaction(id, body.splits);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const r = await unsplitTransaction(id);
  return NextResponse.json({ ok: true, ...r });
}
