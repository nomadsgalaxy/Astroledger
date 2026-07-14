import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { importPdfStatement } from '@/lib/pdfImport';
import { detectSubscriptions } from '@/lib/detectSubscriptions';

export const runtime = 'nodejs';
// PDF batch imports can take a while - each statement is one LLM call. A 47-file
// archive at ~10s/file is ~8min; allow up to 30min for big back-catalogue dumps.
export const maxDuration = 1800;

/**
 * Multipart upload:
 *   - file              (required) the PDF
 *   - accountId         (optional) existing BankAccount to import into
 *   - institutionName   (required if no accountId) - creates a new manual Institution + BankAccount
 *   - accountName       (required if no accountId)
 *   - signConvention    (optional) 'standard' | 'inverted'
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
  const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
  if (!isZip && file.type && !file.type.includes('pdf')) {
    return NextResponse.json({ error: 'Expected a PDF or ZIP of PDFs' }, { status: 400 });
  }

  let accountId = form.get('accountId') as string | null;
  if (!accountId) {
    const institutionName = (form.get('institutionName') as string | null)?.trim();
    const accountName = (form.get('accountName') as string | null)?.trim();
    if (!institutionName || !accountName) {
      return NextResponse.json({ error: 'institutionName + accountName required when no accountId' }, { status: 400 });
    }
    const inst = await prisma.institution.findFirst({ where: { name: institutionName } })
      ?? await prisma.institution.create({ data: { name: institutionName, source: 'manual' } });
    const acct = await prisma.bankAccount.create({
      data: { institutionId: inst.id, name: accountName, type: 'depository', currency: 'USD' },
    });
    accountId = acct.id;
  }

  const signConvention = (form.get('signConvention') as 'standard' | 'inverted' | null) ?? 'standard';
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await importPdfStatement({ buffer, accountId, signConvention });
    // Recompute subscription detection if we actually added anything
    if (result.inserted > 0) { try { await detectSubscriptions(); } catch {} }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
