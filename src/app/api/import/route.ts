import { NextRequest, NextResponse } from 'next/server';
import { importCsv } from '@/lib/importCsv';
import { detectSubscriptions } from '@/lib/detectSubscriptions';
import { buildRecommendations } from '@/lib/recommend';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const accountName = (form.get('accountName') as string) || 'Imported';
    const institutionName = (form.get('institutionName') as string) || accountName;
    const signConvention = (form.get('signConvention') as string) === 'inverted' ? 'inverted' : 'standard';
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    const csvText = await file.text();

    const result = await importCsv({ csvText, accountName, institutionName, signConvention });
    const subs = await detectSubscriptions();
    const recCount = await buildRecommendations();
    return NextResponse.json({ ...result, subscriptions: subs, recommendations: recCount });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
