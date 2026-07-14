import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma, getRequestFinancialAccess } from '@/lib/prisma';
import { deleteEncryptedUpload, writeEncryptedUpload } from '@/lib/receiptStorage';
import { recordSpaceEvent } from '@/lib/spaceEvents';
import { validateUploadContent } from '@/lib/uploadValidation';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_BYTES = 50 * 1024 * 1024;
const KINDS = new Set(['statement', 'tax', 'receipt', 'estate', 'insurance', 'other']);

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const documents = await prisma.financialDocument.findMany({
    include: { account: { select: { id: true, name: true, mask: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ documents });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getRequestFinancialAccess();
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const accountId = String(form.get('accountId') ?? '').trim() || null;
  const kindRaw = String(form.get('kind') ?? 'other');
  const kind = KINDS.has(kindRaw) ? kindRaw : 'other';
  const notes = String(form.get('notes') ?? '').trim().slice(0, 2000) || null;
  if (!file || !file.name) return NextResponse.json({ error: 'Choose a document' }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: 'Documents must be between 1 byte and 50 MB' }, { status: 413 });
  if (accountId && !access.documentManageAccountIds.includes(accountId)) {
    return NextResponse.json({ error: 'You cannot manage documents for that account' }, { status: 403 });
  }
  if (!accountId && !access.canManageDocuments) {
    return NextResponse.json({ error: 'Document management permission is required' }, { status: 403 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const content = validateUploadContent(bytes);
  if (!content.ok) return NextResponse.json({ error: content.error }, { status: 415 });
  const month = new Date().toISOString().slice(0, 7);
  const relativePath = `documents/${access.activeSpaceId}/${month}/${randomUUID()}.aldoc`;
  await writeEncryptedUpload(relativePath, bytes);
  try {
    const document = await prisma.financialDocument.create({
      data: {
        spaceId: access.activeSpaceId,
        accountId,
        uploadedById: access.userId,
        name: file.name.slice(0, 240),
        kind,
        filePath: relativePath,
        mimeType: file.type || 'application/octet-stream',
        byteSize: file.size,
        notes,
      },
    });
    await recordSpaceEvent({
      spaceId: access.activeSpaceId, actorId: access.userId, action: 'document.upload',
      targetType: 'document', targetId: document.id,
      summary: `Uploaded ${kind} document "${document.name}"`,
      after: { kind, byteSize: file.size, accountId, sniffed: content.sniffed },
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    await deleteEncryptedUpload(relativePath);
    throw error;
  }
}
