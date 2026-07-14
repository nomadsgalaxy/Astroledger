#!/usr/bin/env node
/**
 * Astroledger MCP — stdio ↔ HTTP bridge.
 *
 * Speaks MCP over stdio (so Claude Code / Claude Desktop can spawn it like
 * any other local MCP server) but proxies every tool invocation to the
 * production `/api/mcp` HTTP endpoint over Cloudflare Tunnel, using a
 * bearer token for auth.
 *
 * No SSH key, no Docker socket, no VM access — just HTTPS + Bearer.
 * Tool definitions are pulled from the server on startup, so adding a new
 * tool to BUDGET_TOOLS in the prod codebase requires no bridge update.
 *
 * Usage (via Claude Code):
 *   claude mcp add astroledger --scope user \
 *     --env ASTROLEDGER_URL=http://localhost:5050/api/mcp,https://astroledger.example.com/api/mcp \
 *     --env ASTROLEDGER_TOKEN=<your MCP_TOKEN> \
 *     -- node /abs/path/to/mcp/http-bridge.mjs
 *
 * Multiple URLs: pass a comma-separated list to ASTROLEDGER_URL. The bridge
 * probes each in order on startup with a short timeout and uses the first
 * one that responds healthy. Typical setup:
 *   ASTROLEDGER_URL=http://10.0.0.5:5050/api/mcp,https://astroledger.example.com/api/mcp
 *                   ^ fast LAN path, no tunnel       ^ remote fallback
 *
 * Standalone test (no MCP client):
 *   ASTROLEDGER_URL=... ASTROLEDGER_TOKEN=... node mcp/http-bridge.mjs
 *   # then paste JSON-RPC messages on stdin
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const URLS_RAW = process.env.ASTROLEDGER_URL ?? '';
const TOKEN = process.env.ASTROLEDGER_TOKEN;
const URLS = URLS_RAW.split(',').map(s => s.trim()).filter(Boolean);

if (URLS.length === 0 || !TOKEN) {
  process.stderr.write(
    'Error: ASTROLEDGER_URL and ASTROLEDGER_TOKEN env vars must be set.\n' +
    `  ASTROLEDGER_URL=${URLS_RAW ? '<set>' : '<missing>'}\n` +
    `  ASTROLEDGER_TOKEN=${TOKEN ? '<set>' : '<missing>'}\n`,
  );
  process.exit(2);
}

const FETCH_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 1_500;   // per-URL probe budget on startup

// Picked once at startup. Re-probed only when a request fails — see retry
// path in callHttp. Keeps tail latency low and stays on a healthy endpoint
// across short network blips.
let activeUrl = null;

async function probe(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function pickActive() {
  for (const url of URLS) {
    if (await probe(url)) {
      activeUrl = url;
      return url;
    }
  }
  throw new Error(
    `None of the configured URLs are reachable with the supplied token. Tried: ${URLS.join(', ')}`,
  );
}

async function callHttp(method, body) {
  if (!activeUrl) await pickActive();
  const url = activeUrl;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
    }
    return text ? JSON.parse(text) : null;
  } catch (e) {
    // Endpoint went south mid-session — re-probe so subsequent calls
    // hop onto a working URL (e.g. LAN dropped, fall back to public).
    if (URLS.length > 1) {
      activeUrl = null;
      try { await pickActive(); } catch {}
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const server = new Server(
  { name: 'astroledger-http', version: '0.2.2' },
  { capabilities: { tools: {} } },
);

// On every tools/list, ask the server. Cached for the lifetime of this
// process — restart the MCP client (or run `claude mcp restart`) to refresh
// after deploying new tools.
let toolsCache = null;
async function loadTools() {
  if (toolsCache) return toolsCache;
  const discovery = await callHttp('GET', null);
  if (!discovery?.tools || !Array.isArray(discovery.tools)) {
    throw new Error('Discovery response missing `tools` array');
  }
  toolsCache = discovery.tools;
  return toolsCache;
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await loadTools();
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const out = await callHttp('POST', { tool: name, args: args ?? {} });
    const payload = out?.result ?? out;
    return {
      content: [
        {
          type: 'text',
          text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
        },
      ],
    };
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Error: ${e.message ?? String(e)}` }],
      isError: true,
    };
  }
});

async function main() {
  // Eager-load tools so a failed bearer / unreachable URL shows up at
  // startup instead of on the first tool call.
  await loadTools();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `Astroledger MCP (HTTP bridge) ready — ${toolsCache.length} tools loaded from ${activeUrl}` +
    (URLS.length > 1 ? ` (${URLS.length} URLs configured, will failover on error)` : '') +
    `\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e.message ?? String(e)}\n`);
  process.exit(1);
});
