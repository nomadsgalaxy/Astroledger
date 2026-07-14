// GET /api/rules/suggest → candidate categorization rules inferred from the
// user's own categorization patterns (accept by POSTing rule.* to /api/rules).
// Auth via the edge middleware.
import { NextResponse } from 'next/server';
import { suggestRules } from '@/lib/suggestRules';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ suggestions: await suggestRules() });
}
