import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { importQuicken } from '@/lib/quickenImport';
import { detectSubscriptions } from '@/lib/detectSubscriptions';
import { buildRecommendations } from '@/lib/recommend';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const accountName = (form.get('accountName') as string) || 'Imported';
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    const text = await file.text();
    const out = await importQuicken(text, accountName);
    await detectSubscriptions();
    await buildRecommendations();
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
