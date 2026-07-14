// Save credentials for a Playwright adapter. Stored as a JSON blob in
// Institution.accessToken, which is AES-256-GCM encrypted via the vault.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { adapterId, label, creds } = await req.json();
  if (!adapterId || !creds?.username || !creds?.password) {
    return NextResponse.json({ error: 'adapterId + creds.username + creds.password required' }, { status: 400 });
  }
  const source = `playwright:${adapterId}`;
  const existing = await prisma.institution.findFirst({ where: { source } });
  const payload = JSON.stringify(creds);
  if (existing) {
    await prisma.institution.update({ where: { id: existing.id }, data: { accessToken: payload, name: label ?? existing.name } });
    return NextResponse.json({ ok: true, institutionId: existing.id, updated: true });
  }
  const created = await prisma.institution.create({
    data: { name: label ?? `Playwright: ${adapterId}`, source, accessToken: payload },
  });
  return NextResponse.json({ ok: true, institutionId: created.id });
}
