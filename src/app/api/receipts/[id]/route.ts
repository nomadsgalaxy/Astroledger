import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { readDecryptedReceipt } from '@/lib/receiptStorage';

export const runtime = 'nodejs';

// GET /api/receipts/:id - stream the receipt file back, gated by session.
// Defends against path traversal via normalize() + prefix check.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const receipt = await prisma.receipt.findUnique({
    where: { id },
    select: { filePath: true, mimeType: true, originalName: true },
  });
  if (!receipt) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    const buf = await readDecryptedReceipt(receipt.filePath);
    return new NextResponse(buf as any, {
      status: 200,
      headers: {
        'Content-Type': receipt.mimeType,
        'Content-Disposition': `inline; filename="${receipt.originalName.replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('[receipt] unable to read/decrypt receipt', id, (error as Error).message);
    return NextResponse.json({ error: 'file unavailable' }, { status: 404 });
  }
}

// DELETE /api/receipts/:id - remove the DB row. The on-disk file is left in
// place so deletes are recoverable; a separate compaction job can prune them.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await prisma.receipt.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
