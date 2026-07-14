import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { syncPayPal } from '@/lib/paypal';
import { prisma } from '@/lib/prisma';
import { detectSubscriptions } from '@/lib/detectSubscriptions';
import { buildRecommendations } from '@/lib/recommend';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const sinceDays = Math.max(1, Math.min(1095, parseInt(body.sinceDays ?? '365')));
    const institutionId = body.institutionId;
    if (institutionId) {
      const out = await syncPayPal({ institutionId, sinceDays });
      await detectSubscriptions();
      await buildRecommendations();
      return NextResponse.json(out);
    }
    // No id → sync all PayPal institutions
    const insts = await prisma.institution.findMany({ where: { source: 'paypal' } });
    const results = [];
    for (const i of insts) results.push({ institution: i.name, ...(await syncPayPal({ institutionId: i.id, sinceDays })) });
    await detectSubscriptions();
    await buildRecommendations();
    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
