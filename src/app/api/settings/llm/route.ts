import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { LlmProviderConfig, ProviderKind } from '@/lib/llm';

export const runtime = 'nodejs';

const APP_SETTING_KEY = 'llm_provider';
const VALID_KINDS: ProviderKind[] = ['ollama', 'openai', 'custom', 'anthropic', 'disabled'];

/** GET → { config: LlmProviderConfig | null, envFallback: {...} }.
 *  Returns null if no AppSetting is configured (caller should treat env vars
 *  as the source of truth). API key value is NEVER returned. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const row = await prisma.appSetting.findUnique({ where: { key: APP_SETTING_KEY } });
  const cfg = row?.value ? JSON.parse(row.value) as LlmProviderConfig : null;
  return NextResponse.json({
    config: cfg,
    envFallback: {
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? null,
      LLM_MODEL: process.env.LLM_MODEL ?? null,
      LLM_FAST_MODEL: process.env.LLM_FAST_MODEL ?? null,
    },
  });
}

/** POST → { ok, config }. Upserts the AppSetting. Validates kind + that
 *  apiKeyEnv (if provided) resolves to a non-empty value in the current
 *  process env (catches "I configured anthropic but forgot to set the key"). */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(session.user as { isAdmin?: boolean }).isAdmin) return NextResponse.json({ error: 'Instance administrator access is required' }, { status: 403 });
  const body = await req.json().catch(() => null) as LlmProviderConfig | null;
  if (!body || !VALID_KINDS.includes(body.kind)) {
    return NextResponse.json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` }, { status: 400 });
  }
  // Sanity-check apiKeyEnv for non-local providers.
  const needsKey = body.kind === 'openai' || body.kind === 'anthropic';
  if (needsKey) {
    if (!body.apiKeyEnv) {
      return NextResponse.json({ error: `apiKeyEnv is required for kind=${body.kind}` }, { status: 400 });
    }
    if (!process.env[body.apiKeyEnv]) {
      return NextResponse.json({
        error: `apiKeyEnv="${body.apiKeyEnv}" but that env var is not set on the server. ` +
               `Add it to .env (or your hosting platform's secrets) and restart, then save again.`,
      }, { status: 400 });
    }
  }
  await prisma.appSetting.upsert({
    where: { key: APP_SETTING_KEY },
    create: { key: APP_SETTING_KEY, value: JSON.stringify(body) },
    update: { value: JSON.stringify(body) },
  });
  return NextResponse.json({ ok: true, config: body });
}

/** DELETE → clears the AppSetting; LLM config reverts to env-var defaults. */
export async function DELETE() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(session.user as { isAdmin?: boolean }).isAdmin) return NextResponse.json({ error: 'Instance administrator access is required' }, { status: 403 });
  await prisma.appSetting.delete({ where: { key: APP_SETTING_KEY } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
