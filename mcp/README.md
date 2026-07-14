# Astroledger MCP server

Lets external agents (Claude, Gemini, ChatGPT, custom scripts) talk to your
Astroledger database. Two transports:

- **stdio** — for local clients like Claude Code and Claude Desktop. Spawns
  `mcp/server.ts` as a subprocess. The clients pipe JSON-RPC over stdin/stdout.
- **HTTP** — at `POST http://localhost:5050/api/mcp`. For remote agents or
  scripts that can't run a local subprocess.

Both expose the **same tool surface** defined in
[`src/lib/budgetTools.ts`](../src/lib/budgetTools.ts).

## Tools (24 total)

### Read

- `list_transactions` — filter by date / merchant / category / amount / flow.
- `search_transactions` — full-text across merchant + description + notes.
- `hunt_transaction` — investigate one tx: related charges, matching email
  receipts, LLM analysis ("likely service" + cancel steps).
- `list_subscriptions` — detected recurring charges + cadence.
- `list_accounts` — every connected bank account, balance, mask, institution.
- `account_balance` — current balance + `balanceAsOf` for one account.
- `net_worth` — assets, liabilities, breakdown by account kind.
- `list_tags` — the full tag hierarchy (parent → child, primary/secondary).
- `spend_by_category` — total outflow per category over a window.
- `monthly_summary` — net flow + top categories for a YYYY-MM.
- `search_merchant` — aggregate stats for one merchant.
- `top_merchants_in_category` — top N merchants for a category.
- `find_savings` — current recommendations.
- `subscription_cancel_impact` — monthly + annual savings.
- `checkpoint` — plan-vs-actual for the active plan.
- `simulate_change` — recompute plan total if a cap changes.

### Write

- `add_transaction` — insert a manual transaction (useful when an agent
  discovers a charge outside Astroledger's data sources).
- `create_tag` — add a new root or child tag.
- `attach_tags` — apply one or more tags to a transaction. Cascades to same-
  merchant transactions automatically.
- `detach_tag` — remove a tag from a transaction.
- `ingest_order` — push a receipt the agent fetched from email/web. Astroledger
  matches it to the corresponding bank transaction.
- `set_budget` — create/update a monthly cap.
- `mark_subscription` — change a subscription's status.
- `pair_transfers` — re-run the cross-account transfer detector.

## Local (stdio) — Claude Code / Claude Desktop

Claude Desktop config typically lives at:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

Add:

```json
{
  "mcpServers": {
    "astroledger": {
      "command": "npx",
      "args": ["tsx", "/abs/path/to/astroledger/mcp/server.ts"]
    }
  }
}
```

Restart Claude. Tools appear under "astroledger" in the `+` menu.

## Remote / HTTP — Gemini, Claude API, custom agents

Set a token in `.env`:

```
MCP_TOKEN=<long random string, e.g. `openssl rand -hex 32`>
```

Hit the endpoint:

```bash
# Discover available tools
curl -H "Authorization: Bearer $MCP_TOKEN" http://localhost:5050/api/mcp \
  | jq '.tools[] | .name'

# Invoke a tool
curl -X POST http://localhost:5050/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"list_accounts","args":{}}'

# Hunt a charge
curl -X POST http://localhost:5050/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"hunt_transaction","args":{"transaction_id":"<tx-id>"}}'

# Agent pushes a receipt back into Astroledger
curl -X POST http://localhost:5050/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "ingest_order",
    "args": {
      "source":"gemini-agent",
      "merchant":"Crunchyroll",
      "order_date":"2026-05-15",
      "amount":7.99,
      "external_id":"gemini-2026-05-15-cr",
      "url":"https://...",
      "raw":"From: store@crunchyroll.com..."
    }
  }'
```

For remote agents beyond this machine, expose `:5050` via your Cloudflare
Tunnel. `MCP_TOKEN` is the only thing between an attacker and your
transactions — use a long random value and never commit it.

## Agent patterns

**Charge investigator**

> "What was the $7 WP*3d Printer Filament charge from May 15?"
> → `search_transactions("filament")` → pick the row → `hunt_transaction({id})`
> → answer: it's a Crunchyroll bundle. Cancel by going to crunchyroll.com →
> Settings → Subscriptions.

**Receipt enricher** (background daemon)

> Polls Gmail every hour. For each new order email, parses it and calls
> `ingest_order(...)`. Astroledger auto-links to the bank transaction by date +
> amount + merchant tokens, then surfaces line items in `/orders`.

**Tag suggester**

> Calls `list_tags` to know what taxonomy exists, walks `list_transactions`
> with `category: "Other"`, suggests tags, calls `attach_tags`. Skips anything
> already tagged. Cascading auto-applies to all matching merchant rows.

**Tax-time helper** (future)

> Uses `monthly_summary` per month plus `list_transactions` filtered by the
> "Tax deductible" tag to produce a Schedule C draft. Calls `attach_tags` to
> mark expenses the user confirms.
