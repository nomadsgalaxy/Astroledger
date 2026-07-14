import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { LlmProviderConfig } from '@/lib/llm';

export const runtime = 'nodejs';

const ANTHROPIC_DEFAULT_VERSION = '2023-06-01';
const TEST_TIMEOUT_MS = 15_000;

/**
 * POST → { ok, latencyMs, model, sample } | { ok:false, error }
 *
 * Tests a tentative LlmProviderConfig (not yet saved). Issues a 1-token
 * "respond with the word OK" completion. Returns latency + the model's
 * response so the user can sanity-check the wiring before committing.
 *
 * Bypasses the saved AppSetting on purpose — tests the request body
 * verbatim so you can preview a new config without overwriting the live one.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(session.user as { isAdmin?: boolean }).isAdmin) return NextResponse.json({ error: 'Instance administrator access is required' }, { status: 403 });
  const cfg = await req.json().catch(() => null) as LlmProviderConfig | null;
  if (!cfg) return NextResponse.json({ error: 'Body must be a LlmProviderConfig' }, { status: 400 });

  const apiKey = cfg.apiKeyEnv ? (process.env[cfg.apiKeyEnv] ?? '') : '';
  const baseUrl = cfg.baseUrl ?? '';
  const model = cfg.model ?? '';
  if (cfg.kind === 'disabled') return NextResponse.json({ error: 'Cannot test kind=disabled' }, { status: 400 });
  if (!baseUrl) return NextResponse.json({ error: 'baseUrl is required to test' }, { status: 400 });
  if (!model)   return NextResponse.json({ error: 'model is required to test' }, { status: 400 });

  const started = Date.now();
  try {
    let sample: string;
    if (cfg.kind === 'anthropic') {
      if (!apiKey) throw new Error(`Env var ${cfg.apiKeyEnv ?? '(unset)'} resolves empty`);
      const res = await fetch(baseUrl + '/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_DEFAULT_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'Reply with the word OK and nothing else.' }],
        }),
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      sample = Array.isArray(data.content)
        ? data.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        : JSON.stringify(data).slice(0, 200);
    } else {
      const res = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with the word OK and nothing else.' }],
          temperature: 0,
          max_tokens: 8,
        }),
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      sample = data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 200);
    }
    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - started,
      model,
      sample: sample.trim().slice(0, 200),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      latencyMs: Date.now() - started,
      error: (e as Error).message ?? String(e),
    }, { status: 200 }); // 200 — the test ran, it just failed; UI parses ok flag
  }
}
