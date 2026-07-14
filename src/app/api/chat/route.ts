import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { chat } from '@/lib/llm';
import { ensureLlmRunning, touchLlm } from '@/lib/llmDocker';
import { runBudgetTool, BUDGET_TOOLS, isWriteTool } from '@/lib/budgetTools';
import { rateLimit } from '@/lib/rateLimit';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

// Chat turns are expensive (LLM round-trips + tool calls) — cap per user/min.
const CHAT_LIMIT = 30;
const CHAT_WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  // Naive CSRF gate: a cross-site form post would not have Sec-Fetch-Site
  // set, or would set it to "cross-site". Modern browsers send "same-origin"
  // for first-party fetches from the chat UI. `none` covers the case where
  // the request was typed into the URL bar (tolerated for dev / curl
  // testing). Rejects forged form-action POSTs from a third-party page.
  const sfs = req.headers.get('sec-fetch-site');
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }
  const session = await auth();
  const actor = session?.user ? `session:${session.user.email ?? 'user'}` : 'anon';
  const rl = rateLimit(`chat:${actor}`, CHAT_LIMIT, CHAT_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Rate limit exceeded — retry in ${rl.retryAfterSec}s` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }
  const status = await ensureLlmRunning();
  if (!status.ok) return NextResponse.json({ error: status.error ?? 'LLM unavailable' }, { status: 503 });
  touchLlm();
  const { messages } = await req.json();
  const systemPrompt = `You are Spacer, the inference layer inside Astroledger. You are NOT a licensed financial advisor and you do not provide financial advice, investment advice, tax advice, or legal advice. Refuse politely if asked, and redirect to the user's own data.

Your role is strictly to read and summarize the user's own transaction data through the tools available to you. You can:
- Identify merchants from raw transaction descriptors
- Summarize where money went over a given window
- Spot patterns (recurring charges, unusual spikes, category drift)
- Surface specific transactions on request

You must NOT:
- Recommend specific investments, accounts, products, or financial actions
- Predict future returns or market movements
- Tell the user whether to buy, sell, save, or spend
- Generate advice that requires a fiduciary relationship

Be specific, cite exact dollar amounts and dates from tool results, and never guess a number - call a tool. If a question requires advice rather than inference on existing data, say so and offer to surface relevant transactions instead.`;

  const conversation = [{ role: 'system' as const, content: systemPrompt }, ...messages];
  // Trace of every tool invocation so the UI can show what data the model
  // queried before settling on an answer.
  const toolTrace: Array<{ name: string; args: Record<string, unknown>; resultSummary: string }> = [];

  // Up to 6 tool-call iterations. Each iteration:
  //   1. Ask the model for a reply or a batch of tool calls
  //   2. Execute every tool call inside a try/catch so a single tool error
  //      surfaces as a structured `{ error }` result instead of crashing
  //      the chat — the model can recover or refuse on the next pass.
  //   3. Append all results before re-asking. Bounded by a per-iteration
  //      tool-call ceiling so a runaway loop can't burn the budget.
  const startedAt = Date.now();
  const MAX_TOOL_CALLS_PER_ITER = 8;
  const iterations: Array<{ i: number; ms: number; toolCount: number }> = [];
  for (let i = 0; i < 6; i++) {
    const iterStart = Date.now();
    const res = await chat(conversation, { tools: BUDGET_TOOLS, temperature: 0.2 });
    if (!res.toolCalls?.length) {
      iterations.push({ i, ms: Date.now() - iterStart, toolCount: 0 });
      return NextResponse.json({
        reply: res.content,
        toolTrace,
        meta: { iterations, totalMs: Date.now() - startedAt },
      });
    }
    const calls = res.toolCalls.slice(0, MAX_TOOL_CALLS_PER_ITER);
    conversation.push({ role: 'assistant', content: res.content, tool_calls: calls.map(tc => ({
      id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    })) } as any);
    for (const tc of calls) {
      let outStr: string;
      const write = isWriteTool(tc.name);
      try {
        const out = await runBudgetTool(tc.name, tc.arguments);
        outStr = JSON.stringify(out);
        // Audit mutating tool calls the model makes on the user's behalf.
        if (write) await recordAudit({ surface: 'chat', actor, tool: tc.name, isWrite: true, ok: true });
      } catch (err) {
        outStr = JSON.stringify({ error: (err as Error).message ?? String(err) });
        if (write) await recordAudit({ surface: 'chat', actor, tool: tc.name, isWrite: true, ok: false, error: (err as Error).message });
      }
      toolTrace.push({
        name: tc.name, args: tc.arguments,
        resultSummary: outStr.length > 200 ? outStr.slice(0, 200) + '…' : outStr,
      });
      conversation.push({
        role: 'tool', tool_call_id: tc.id, name: tc.name,
        content: outStr.slice(0, 16000),
      });
    }
    iterations.push({ i, ms: Date.now() - iterStart, toolCount: calls.length });
  }
  return NextResponse.json({
    reply: '(Reached tool-call limit without final answer.)',
    toolTrace,
    meta: { iterations, totalMs: Date.now() - startedAt },
  });
}
