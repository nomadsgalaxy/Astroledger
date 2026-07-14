import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncTransactions } from '@/lib/plaid';
import { detectSubscriptions } from '@/lib/detectSubscriptions';
import { buildRecommendations } from '@/lib/recommend';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const insts = await prisma.institution.findMany({ where: { source: 'plaid' } });
    const results = [];
    for (const i of insts) results.push({ institution: i.name, ...(await syncTransactions(i.id)) });
    await detectSubscriptions();
    const recs = await buildRecommendations();
    return NextResponse.json({ results, recommendations: recs });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
