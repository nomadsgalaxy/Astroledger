import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { deleteEncryptedUpload, readDecryptedUpload } from '@/lib/receiptStorage';
import { recordSpaceEvent } from '@/lib/spaceEvents';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const document = await prisma.financialDocument.findUnique({ where: { id } });
  if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  const body = await readDecryptedUpload(document.filePath);
  const safeName = document.name.replace(/["\r\n]/g, '_');
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const document = await prisma.financialDocument.findUnique({ where: { id } });
  if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  const removed = await prisma.financialDocument.deleteMany({ where: { id } });
  if (!removed.count) return NextResponse.json({ error: 'Document management permission is required' }, { status: 403 });
  await deleteEncryptedUpload(document.filePath);
  await recordSpaceEvent({
    spaceId: document.spaceId, actorId: (session.user as { id: string }).id, action: 'document.delete',
    targetType: 'document', targetId: document.id,
    summary: `Deleted ${document.kind} document "${document.name}"`,
    before: { kind: document.kind, byteSize: document.byteSize, accountId: document.accountId },
  });
  return NextResponse.json({ ok: true });
}
