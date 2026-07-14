/**
 * HTTP transport for the Astroledger MCP surface.
 *
 * The same budget tools that the stdio MCP server exposes (mcp/server.ts) are
 * also reachable over HTTP for remote agents (Claude API, Gemini, ChatGPT,
 * homemade scripts). Two operations:
 *
 *   GET  /api/mcp                   → JSON-RPC-ish discovery: lists every tool
 *                                     with its name + description + inputSchema
 *   POST /api/mcp { tool, args }    → invoke a tool, returns { result }
 *
 * Auth: requires either a logged-in session cookie OR a bearer token equal to
 * the MCP_TOKEN env var (preferred for remote agents). The token never leaves
 * this machine - set it locally and share via your agent's auth config.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { BUDGET_TOOLS, runBudgetTool, isWriteTool } from '@/lib/budgetTools';
import { rateLimit } from '@/lib/rateLimit';
import { recordAudit, tokenActor } from '@/lib/audit';
import pkg from '../../../../package.json';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Per-actor request ceiling across the whole MCP surface (reads + writes).
const MCP_LIMIT = 240;       // requests
const MCP_WINDOW_MS = 60_000; // per minute

// Resolve the caller to an actor label, or null if unauthorized. Token auth
// (remote agents) is attributed by a non-reversible hash; session auth by email.
async function identify(req: Request): Promise<string | null> {
  const token = process.env.MCP_TOKEN;
  if (token) {
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (bearer && bearer === token) return tokenActor(bearer);
  }
  const session = await auth();
  return session?.user ? `session:${session.user.email ?? 'user'}` : null;
}

function tooMany(retryAfterSec: number) {
  return NextResponse.json(
    { error: `Rate limit exceeded — retry in ${retryAfterSec}s` },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
  );
}

export async function GET(req: Request) {
  const actor = await identify(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized - set MCP_TOKEN env var or use a session cookie' }, { status: 401 });
  const rl = rateLimit(`mcp:${actor}`, MCP_LIMIT, MCP_WINDOW_MS);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  return NextResponse.json({
    name: 'astroledger',
    version: pkg.version,
    transport: 'http',
    tools: BUDGET_TOOLS.map(t => ({
      name: t.function.name,
      description: t.function.description,
      inputSchema: t.function.parameters,
    })),
  });
}

export async function POST(req: Request) {
  const actor = await identify(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized - set MCP_TOKEN env var or use a session cookie' }, { status: 401 });
  const rl = rateLimit(`mcp:${actor}`, MCP_LIMIT, MCP_WINDOW_MS);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const body = await req.json().catch(() => null) as null | { tool?: string; args?: Record<string, unknown> };
  if (!body?.tool) return NextResponse.json({ error: 'Missing tool name' }, { status: 400 });
  const write = isWriteTool(body.tool);
  try {
    const result = await runBudgetTool(body.tool, (body.args ?? {}) as Record<string, unknown>);
    await recordAudit({ surface: 'mcp', actor, tool: body.tool, isWrite: write, ok: true });
    return NextResponse.json({ tool: body.tool, result });
  } catch (err) {
    await recordAudit({ surface: 'mcp', actor, tool: body.tool, isWrite: write, ok: false, error: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
