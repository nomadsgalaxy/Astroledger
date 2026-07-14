import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ocrReceipt } from '@/lib/receiptOcr';
import { writeEncryptedReceipt } from '@/lib/receiptStorage';
import { validateUploadContent } from '@/lib/uploadValidation';
import { randomBytes } from 'node:crypto';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_SIZE = 15 * 1024 * 1024;          // 15 MB per upload
const ALLOWED = /^(image\/(png|jpeg|jpg|webp|heic|gif)|application\/pdf)$/i;

/**
 * Upload a receipt for a transaction. Optionally OCR via vision LLM and
 * populate parsedAmount/parsedMerchant/parsedDate fields. If no
 * transactionId is supplied, the receipt is parked and can be linked later.
 *
 * Multipart fields:
 *   file:           the receipt file (required)
 *   transactionId:  optional; receipt is orphaned otherwise (caller must link)
 *   skipOcr:        '1' to skip vision OCR (faster)
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
  if (file.size > MAX_SIZE)    return NextResponse.json({ error: `File too large (max ${MAX_SIZE / 1024 / 1024} MB)` }, { status: 413 });
  if (!ALLOWED.test(file.type)) return NextResponse.json({ error: `Unsupported type ${file.type}` }, { status: 415 });

  const transactionId = (form.get('transactionId') as string) || null;
  const skipOcr = form.get('skipOcr') === '1';

  // Validate transaction exists (if linking)
  if (transactionId) {
    const exists = await prisma.transaction.findUnique({ where: { id: transactionId }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: 'transaction not found' }, { status: 404 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const content = validateUploadContent(buf);
  if (!content.ok) return NextResponse.json({ error: content.error }, { status: 415 });
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'bin').toLowerCase();
  const yyyymm = new Date().toISOString().slice(0, 7);   // 2026-05
  const slug = randomBytes(6).toString('hex');
  const stored = `${Date.now()}-${slug}.${ext}.enc`;
  const relPath = `receipts/${yyyymm}/${stored}`;
  await writeEncryptedReceipt(relPath, buf);

  // Best-effort OCR
  let ocr = null;
  if (!skipOcr) {
    ocr = await ocrReceipt(buf, file.type);
  }
  const parsedDate = ocr?.date ? new Date(ocr.date) : null;

  if (!transactionId) {
    // Orphan receipt - no place to write the row yet. Just return parse result.
    return NextResponse.json({
      ok: true,
      orphaned: true,
      filePath: relPath,
      parse: ocr ?? null,
    });
  }

  const receipt = await prisma.receipt.create({
    data: {
      transactionId,
      filePath: relPath,
      mimeType: file.type,
      byteSize: file.size,
      originalName: file.name,
      parsedAmount: ocr?.amount ?? null,
      parsedMerchant: ocr?.merchant ?? null,
      parsedDate: parsedDate && !Number.isNaN(+parsedDate) ? parsedDate : null,
      ocrText: ocr?.ocrText ?? null,
      confidence: ocr?.confidence ?? null,
    },
    select: { id: true, filePath: true, parsedAmount: true, parsedMerchant: true, parsedDate: true, confidence: true },
  });

  return NextResponse.json({ ok: true, receipt });
}
