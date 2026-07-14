#!/usr/bin/env node
// Astroledger MCP server — exposes the same budget tools defined in src/lib/budgetTools.ts
// over the Model Context Protocol so any MCP-aware client (Claude Code, Claude Desktop)
// can query your budget data directly.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BUDGET_TOOLS, runBudgetTool } from '../src/lib/budgetTools';
import pkg from '../package.json';

const server = new Server(
  { name: 'astroledger', version: pkg.version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: BUDGET_TOOLS.map(t => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const out = await runBudgetTool(name, (args ?? {}) as Record<string, any>);
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  } catch (e: any) {
    return { content: [{ type: 'text', text: `Error: ${e.message ?? String(e)}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // No stdout logging — stdio transport uses stdout for protocol.
  process.stderr.write('Astroledger MCP server ready\n');
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e}\n`);
  process.exit(1);
});
