// Tools the LLM (chat API) AND the MCP server expose for querying budget data.
// Single source of truth - keep both surfaces consistent.
//
// Side-effect classification is declared explicitly via WRITE_TOOLS below so
// callers (chat route, MCP, future audit middleware) can treat read-only
// queries differently from data-mutating ones. When you add a new tool that
// changes data, also add its name to WRITE_TOOLS.

import { prisma } from './prisma';
import type { ToolDef } from './llm';
import { buildExpenseReport } from './expenseReport';
import { getReadyToAssign, currentMonthYear } from './envelopes';
import { getReconcileState, reconcileDifference, tiesOut } from './reconciliation';
import { healthBadge } from './syncHealth';
import { activeFinancialSpaceId } from './spaceContext';

// Tools that mutate persistent state. Used for audit logging + future auth
// gating. Read-only tools are everything else.
export const WRITE_TOOLS = new Set<string>([
  'set_budget',
  'assign_to_category',
  'mark_cleared',
  'reconcile_account',
  'sync_now',
  'mark_subscription',
  'create_tag',
  'update_tag',
  'attach_tags',
  'detach_tag',
  'add_transaction',
  'ingest_order',
  'pair_transfers',
  'pair_transactions',
  'dismiss_pairing_candidates',
  'unpair_transfer',
  'update_transaction',
  'refresh_prices',
  'create_schedule',
]);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

// Tag reference resolution: agents pass tag names, cuids, OR uuids in the
// same `tag_names` array. We detect shape by regex, prefer id/uuid lookups
// (always unambiguous), and fall back to name. A name that matches multiple
// rows is flagged as ambiguous so the caller can disambiguate by id.
const CUID_RE = /^c[a-z0-9]{20,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ResolvedTag = { id: string; name: string; parentId: string | null; uuid: string | null };
type AmbiguousRef = { ref: string; candidates: Array<{ id: string; name: string; parent: string | null }> };

async function resolveTagRefs(refs: string[]): Promise<{
  tags: ResolvedTag[];
  unknown: string[];
  ambiguous: AmbiguousRef[];
}> {
  const byId: string[] = [];
  const byUuid: string[] = [];
  const byName: string[] = [];
  for (const r of refs) {
    if (UUID_RE.test(r)) byUuid.push(r);
    else if (CUID_RE.test(r)) byId.push(r);
    else byName.push(r);
  }

  const found: ResolvedTag[] = [];
  if (byId.length) {
    const rows = await prisma.tag.findMany({
      where: { id: { in: byId } },
      select: { id: true, name: true, parentId: true, uuid: true },
    });
    found.push(...rows);
  }
  if (byUuid.length) {
    const rows = await prisma.tag.findMany({
      where: { uuid: { in: byUuid } },
      select: { id: true, name: true, parentId: true, uuid: true },
    });
    found.push(...rows);
  }

  const ambiguous: AmbiguousRef[] = [];
  const unknown: string[] = [];

  // id/uuid that didn't resolve
  for (const id of byId) if (!found.some(t => t.id === id)) unknown.push(id);
  for (const u of byUuid) if (!found.some(t => t.uuid === u)) unknown.push(u);

  if (byName.length) {
    const rows = await prisma.tag.findMany({
      where: { name: { in: byName } },
      select: { id: true, name: true, parentId: true, uuid: true, parent: { select: { name: true } } },
    });
    const grouped = new Map<string, typeof rows>();
    for (const r of rows) {
      const g = grouped.get(r.name) ?? [];
      g.push(r);
      grouped.set(r.name, g);
    }
    for (const name of byName) {
      const matches = grouped.get(name) ?? [];
      if (matches.length === 0) { unknown.push(name); continue; }
      if (matches.length === 1) {
        found.push(matches[0]);
        continue;
      }
      ambiguous.push({
        ref: name,
        candidates: matches.map(m => ({ id: m.id, name: m.name, parent: m.parent?.name ?? null })),
      });
    }
  }

  return { tags: found, unknown, ambiguous };
}

// Resolve an account reference that may be a cuid id OR a (partial) name.
// Returns { account } on a unique match, or { error } describing why not — so
// the verbs that take an `account` string (reconciliation) fail loudly instead
// of silently acting on the wrong account.
//
// `strict` (used by destructive verbs like reconcile_account) disables the
// fuzzy `contains` fallback: only an exact id or exact unique name is accepted,
// so a partial-name match can never silently target — and then mutate — the
// wrong account.
async function resolveAccountRef(ref: string, opts: { strict?: boolean } = {}): Promise<
  | { account: { id: string; name: string } }
  | { error: string }
> {
  const r = (ref ?? '').trim();
  if (!r) return { error: 'account is required (id or name)' };
  // Exact id first (unambiguous).
  if (CUID_RE.test(r)) {
    const byId = await prisma.bankAccount.findUnique({ where: { id: r }, select: { id: true, name: true } });
    if (byId) return { account: byId };
  }
  // Exact name.
  const exact = await prisma.bankAccount.findMany({ where: { name: r }, select: { id: true, name: true } });
  if (exact.length === 1) return { account: exact[0] };
  if (exact.length > 1) {
    return { error: `Account name "${r}" matches ${exact.length} accounts — pass the id instead. Candidates: ${exact.map(a => a.id).join(', ')}` };
  }
  if (opts.strict) {
    return { error: `No account exactly matches "${r}". Pass an exact account id or full name (fuzzy matching is disabled for this action).` };
  }
  // Case-insensitive contains, but Prisma's SQLite `contains` lowers to LIKE
  // WITHOUT escaping `%`/`_`, so a ref like "PNC_" or "%" would be treated as a
  // wildcard pattern. Fetch a candidate set then filter to a LITERAL
  // (case-insensitive) substring match in JS so wildcards can't match unintended
  // accounts.
  const lc = r.toLowerCase();
  const candidates = await prisma.bankAccount.findMany({ select: { id: true, name: true } });
  const fuzzy = candidates.filter(a => a.name.toLowerCase().includes(lc));
  if (fuzzy.length === 1) return { account: fuzzy[0] };
  if (fuzzy.length > 1) {
    return { error: `"${r}" matches ${fuzzy.length} accounts: ${fuzzy.map(a => `${a.name} (${a.id})`).join('; ')}. Be more specific or pass the id.` };
  }
  return { error: `No account matches "${r}".` };
}

// Validate an optional `month` arg. Absent → current month. Present-but-malformed
// → error (mirrors the HTTP /api/envelopes routes, which reject a bad monthYear
// rather than silently defaulting and misallocating money to the wrong month).
function resolveMonthArg(month: unknown): { monthYear: string } | { error: string } {
  if (month === undefined || month === null || month === '') return { monthYear: currentMonthYear() };
  if (typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)) return { monthYear: month };
  return { error: 'month must be in "YYYY-MM" format' };
}

export const BUDGET_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'list_transactions',
      description: 'List transactions, optionally filtered. Returns date, merchant, amount, category.',
      parameters: {
        type: 'object',
        properties: {
          since: { type: 'string', description: 'ISO date or YYYY-MM-DD. Inclusive.' },
          until: { type: 'string', description: 'ISO date or YYYY-MM-DD. Inclusive.' },
          merchant: { type: 'string', description: 'Substring match on merchant name.' },
          category: { type: 'string', description: 'Exact category name.' },
          min_amount: { type: 'number', description: 'Absolute minimum amount.' },
          max_amount: { type: 'number', description: 'Absolute maximum amount.' },
          flow: { type: 'string', enum: ['inflow', 'outflow', 'all'], description: 'Default outflow.' },
          limit: { type: 'number', description: 'Max rows (default 100, max 500).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_subscriptions',
      description: 'List detected recurring subscriptions with cadence and est. next charge.',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['active', 'canceled', 'paused', 'review', 'all'] } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spend_by_category',
      description: 'Total outflow per category over a window. Returns sorted descending.',
      parameters: {
        type: 'object',
        properties: {
          since: { type: 'string' }, until: { type: 'string' },
          window_days: { type: 'number', description: 'Used if since/until omitted.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'monthly_summary',
      description: 'Inflow, outflow, net, and top categories for a given month (YYYY-MM).',
      parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' } }, required: ['month'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_savings',
      description: 'Return current savings recommendations (duplicate subs, price hikes, unused subs, heavy spend).',
      parameters: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'dismissed', 'done', 'all'] } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_merchant',
      description: 'Get aggregate stats for a merchant: total spend, count, first/last seen, avg per charge.',
      parameters: { type: 'object', properties: { merchant: { type: 'string' } }, required: ['merchant'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_budget',
      description: 'Create or update a monthly budget for a category or overall.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Category name. Omit for overall.' },
          monthly: { type: 'number' },
        },
        required: ['monthly'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assign_to_category',
      description: 'Zero-based budgeting: assign money to a monthly envelope (give a dollar a job). Updates the envelope\'s allocation and returns the recomputed Ready-to-Assign (spendable cash minus everything assigned). If the named envelope does not exist for the month, provide a tag or category to create it. Write.',
      parameters: {
        type: 'object',
        properties: {
          envelope: { type: 'string', description: 'Envelope name (e.g. "Groceries").' },
          amount: { type: 'number', description: 'Dollar amount. With mode=set this is the new allocation; with mode=delta it is added to the current one.' },
          mode: { type: 'string', enum: ['set', 'delta'], description: 'Default "set".' },
          month: { type: 'string', description: 'Target month "YYYY-MM". Default current month.' },
          tag: { type: 'string', description: 'Tag name to bind the envelope to, used only when creating a new envelope.' },
          category: { type: 'string', description: 'Category name to bind the envelope to, used only when creating a new envelope. Mutually exclusive with tag.' },
        },
        required: ['envelope', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ready_to_assign',
      description: 'Zero-based budgeting status for a month: spendable cash (liquid checking/savings/wallet balances), total assigned to envelopes, and Ready-to-Assign (cash − assigned). Zero means every dollar has a job; negative means over-assigned. Read.',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'Target month "YYYY-MM". Default current month.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forecast_summary',
      description: 'Forward-looking money projection: the 90-day daily cash-position low-water mark, plus the latest 12-month forecast of projected income, spending, and net (income − spending) with a per-month breakdown. Run the forecast generator first (Forecast page → Generate) if no long-range forecast exists yet. Read.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recent_activity',
      description: 'Recent agent-surface tool activity from the audit log (MCP + chat tool calls): what tool ran, on which surface, by which actor, whether it was a write, and the outcome. Use to review what automated/agent activity has touched the data. Read.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many recent entries (default 25, max 200).' },
          writes_only: { type: 'boolean', description: 'Only mutating (write) calls. Default false.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'debt_payoff_plan',
      description: 'Debt-payoff strategy comparison across all credit/loan accounts that have an APR + minimum payment set: avalanche (highest APR first) vs snowball (smallest balance first), with months-to-debt-free, total interest, payoff order, and how much avalanche saves. Provide monthly_budget (total you can pay toward debt each month) or it defaults to minimums + $100. Read.',
      parameters: {
        type: 'object',
        properties: {
          monthly_budget: { type: 'number', description: 'Total monthly dollars available for debt payments. Must cover the combined minimums. Defaults to minimums + $100.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scenario_runway',
      description: 'Savings runway: how long liquid savings last at the current monthly net cashflow (income − spending), or how fast they grow if net-positive. Optionally pass `deltas` (signed monthly dollar adjustments, positive = more money/mo e.g. cutting a cost or a raise, negative = a new expense) to model a what-if on top of the baseline. Read.',
      parameters: {
        type: 'object',
        properties: {
          deltas: { type: 'array', items: { type: 'number' }, description: 'Monthly adjustments to stack on the baseline net. Positive = more money each month, negative = less.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_rules',
      description: 'Auto-learned categorization rule suggestions inferred from existing patterns: merchants consistently filed under one category that no rule covers yet. Each suggestion includes a ready-to-create rule (merchant → category) with a confidence. Read (create the rule via create_tag/the rules UI or by accepting the suggestion).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'holdings_summary',
      description: 'Investment holdings summary in base currency: total market value, cost basis, unrealized gain/loss (+%), allocation by account, and top positions with their portfolio weight. Foreign-currency holdings are FX-converted. Read.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_summary',
      description: 'Recurring money commitments: monthly recurring income vs outflow (subscriptions + manual entries) and the next 60 days of upcoming recurring events. Read.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_schedule',
      description: 'Add a manual recurring money event (income or expense) that auto-detection misses — a paycheck, rent, quarterly tax. Feeds the schedule view + cashflow forecast. Write.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'number', description: 'Signed: positive = income, negative = expense.' },
          cadence_days: { type: 'number', description: 'Days between occurrences (7/14/30/91/365). Default 30.' },
          next_date: { type: 'string', description: 'Next occurrence "YYYY-MM-DD". Default today.' },
        },
        required: ['name', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'refresh_prices',
      description: 'Fetch live quotes for exchange-listed holdings (requires a price-provider API key — Polygon/Finnhub/Alpha Vantage — in the environment) and update their market value. Returns how many were updated/skipped/failed. Write.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reconciliation_status',
      description: 'Statement-reconciliation status for one account: book balance (all transactions), cleared balance (Σ cleared rows), already-reconciled (locked) balance, and counts of cleared/locked/uncleared rows. Use before reconcile_account to see how far the account is from tying out. Read.',
      parameters: {
        type: 'object',
        properties: {
          account: { type: 'string', description: 'Account id (cuid) or name (exact or partial).' },
        },
        required: ['account'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'connection_health',
      description: 'Live-connector sync health per institution: last successful sync time, status (ok | stale | auth_error | network_error | never | disconnected), last error, and a human badge. Use to diagnose why new transactions stopped importing. Read.',
      parameters: {
        type: 'object',
        properties: {
          institution: { type: 'string', description: 'Optional institution id or name to filter to one. Omit for all live institutions.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_cleared',
      description: 'Mark a transaction cleared (it appears on a bank statement) or un-cleared. Un-clearing also clears any reconciliation lock on that row so the cleared balance stays correct. Write.',
      parameters: {
        type: 'object',
        properties: {
          transaction_id: { type: 'string', description: 'Transaction id (cuid).' },
          cleared: { type: 'boolean', description: 'true to mark cleared, false to un-clear.' },
        },
        required: ['transaction_id', 'cleared'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reconcile_account',
      description: 'Lock a statement reconciliation: stamps every currently-cleared row as reconciled and records the account\'s reconciled-as-of date. Refuses (returns out_of_balance) when the cleared balance does not equal the entered statement balance, unless create_adjustment is true — then it creates a single visible balancing "Reconciliation adjustment" row for the residual. Check reconciliation_status / mark_cleared first. Write.',
      parameters: {
        type: 'object',
        properties: {
          account: { type: 'string', description: 'Account id (cuid) or name.' },
          statement_balance: { type: 'number', description: "The bank statement's ending balance (same sign convention as the account ledger: negative for credit-card debt)." },
          statement_date: { type: 'string', description: 'Statement closing date "YYYY-MM-DD". Default today.' },
          create_adjustment: { type: 'boolean', description: 'When the books do not tie out, create a balancing adjustment row for the residual and lock anyway. Default false (returns out_of_balance instead).' },
        },
        required: ['account', 'statement_balance'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sync_now',
      description: 'Trigger a live connector refresh (SimpleFIN / Plaid / PayPal) right now and record per-institution sync health. Requires the encryption vault to be unlocked (returns an error otherwise) since it must decrypt connector credentials. Pulls real data from the providers. Write.',
      parameters: {
        type: 'object',
        properties: {
          institution: { type: 'string', description: 'Optional institution id to sync just one. Omit to refresh all live institutions.' },
          since_days: { type: 'number', description: 'Lookback window in days (1–1095). Default 365.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_subscription',
      description: 'Update a subscription status (e.g. mark canceled).',
      parameters: {
        type: 'object',
        properties: {
          subscription_id: { type: 'string' },
          status: { type: 'string', enum: ['active', 'canceled', 'paused', 'review'] },
        },
        required: ['subscription_id', 'status'],
      },
    },
  },
  // ===== Coach tools (Phase 3 LLM coach) =====
  {
    type: 'function',
    function: {
      name: 'top_merchants_in_category',
      description: 'Top N merchants by outflow in a category over a period (default last 30 days).',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          since_days: { type: 'number' },
          limit: { type: 'number' },
        },
        required: ['category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'subscription_cancel_impact',
      description: 'Monthly + annual savings if a subscription is canceled.',
      parameters: {
        type: 'object',
        properties: { subscription_id: { type: 'string' } },
        required: ['subscription_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'simulate_change',
      description: 'Recompute the active plan total if a category cap is changed.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          new_monthly_target: { type: 'number' },
        },
        required: ['category', 'new_monthly_target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkpoint',
      description: 'Plan-vs-actual for the active plan over a period.',
      parameters: {
        type: 'object',
        properties: { period: { type: 'string', enum: ['month', 'quarter', 'ytd'] } },
      },
    },
  },

  // ===== Phase 4: Agent-facing read/write surface =====
  // These let external agents (Claude, Gemini, ChatGPT via MCP client) use
  // Astroledger as both a data SOURCE (read accounts/tags/tx) and a data SINK
  // (push new transactions, attach tags, ingest receipts).

  {
    type: 'function',
    function: {
      name: 'list_accounts',
      description: 'List all bank accounts with balance, mask, institution, and kind. Read.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'account_balance',
      description: 'Return current balance + balanceAsOf for one account by id. Read.',
      parameters: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'net_worth',
      description: 'Sum of all account balances grouped by kind (assets vs liabilities). Read.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'financial_statements',
      description: 'Accountant-style statements for a period: Balance Sheet (as of today), Income Statement (P&L), and Cash Flow. Returns aggregated line items only. from/to are YYYY-MM-DD (default: last 90 days). Read.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Period start YYYY-MM-DD (default 90 days ago)' },
          to: { type: 'string', description: 'Period end YYYY-MM-DD (default today)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tags',
      description: 'List all tags with parent/kind hierarchy and uuid. Read.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_tag',
      description: 'Create a new tag. parent_name optional. kind = primary | secondary. Write.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          parent_name: { type: 'string', description: 'Existing parent tag name. Omit for a root tag.' },
          kind: { type: 'string', enum: ['primary', 'secondary'] },
          color: { type: 'string', description: 'Hex like #FD5000' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'attach_tags',
      description: 'Attach one or more tags to a transaction. Each tag_names entry can be a tag NAME, a CUID id, OR a UUID — the resolver picks the right lookup by shape. If a name matches multiple tags (e.g. "Entertainment" exists as both a primary and a child of Subscription), the call errors with the candidate ids; resubmit with the specific id. Write. Propagates to same-merchant tx automatically.',
      parameters: {
        type: 'object',
        properties: {
          transaction_id: { type: 'string' },
          tag_names: { type: 'array', items: { type: 'string' }, description: 'Names, cuids, or uuids. Mix-and-match allowed.' },
        },
        required: ['transaction_id', 'tag_names'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detach_tag',
      description: 'Remove a tag from a transaction. tag_name accepts a name, cuid, or uuid (shape-detected). Errors on ambiguous name with candidate ids. Write.',
      parameters: {
        type: 'object',
        properties: {
          transaction_id: { type: 'string' },
          tag_name: { type: 'string', description: 'Name, cuid, or uuid.' },
        },
        required: ['transaction_id', 'tag_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_tag',
      description: 'Edit an existing tag in place. Use to rename (resolves the long-standing collision problem when two tags share a name across branches), recolor, reparent, or flip kind. The tag\'s id + uuid are preserved, so every attached transaction stays attached. Renaming to a name already in use is rejected. If kind ends up secondary with no parent, the tag is auto-routed under the Modifier primary. Write.',
      parameters: {
        type: 'object',
        properties: {
          id:           { type: 'string', description: 'Tag cuid. Preferred when current_name is ambiguous.' },
          current_name: { type: 'string', description: 'Existing tag name. Required if id is omitted. Errors if the name is ambiguous - retry with id.' },
          new_name:     { type: 'string', description: 'Replacement name. Must be unique across the whole tag tree.' },
          color:        { type: 'string', description: 'Hex like #FD5000. Pass null to clear (inherit from parent).' },
          parent_name:  { type: 'string', description: 'New parent tag name. Pass null to remove the parent.' },
          parent_id:    { type: 'string', description: 'New parent tag cuid. Wins over parent_name if both are given.' },
          kind:         { type: 'string', enum: ['primary', 'secondary'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_transaction',
      description: 'Insert a manual transaction. Use for transactions an agent discovered outside Astroledger (e.g. a Venmo charge the bank doesn\'t show yet). Write.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          amount: { type: 'number', description: 'Negative = outflow, positive = inflow' },
          merchant: { type: 'string' },
          description: { type: 'string', description: 'Raw description / memo' },
          tag_names: { type: 'array', items: { type: 'string' } },
        },
        required: ['account_id', 'date', 'amount', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_transactions',
      description: 'Full-text search across merchant, raw description, and notes. Returns paginated results. Read.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', description: 'Default 50, max 200.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hunt_transaction',
      description: 'Investigate a transaction: returns related tx, matching email receipts, and (if local LLM available) likely service + cancel steps. Use this when a user asks "what is this charge?". Read.',
      parameters: {
        type: 'object',
        properties: { transaction_id: { type: 'string' } },
        required: ['transaction_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ingest_order',
      description: 'Push a receipt/order the agent retrieved from email, website, or document. Astroledger will try to match it to an existing transaction. Write.',
      parameters: {
        type: 'object',
        properties: {
          source:        { type: 'string', description: 'Where it came from (e.g. "gmail", "claude-agent", "gemini-agent").' },
          merchant:      { type: 'string' },
          order_date:    { type: 'string', description: 'YYYY-MM-DD' },
          amount:        { type: 'number', description: 'Positive number - total charged.' },
          external_id:   { type: 'string', description: 'Optional uniqueness key (email msg id, order #).' },
          url:           { type: 'string' },
          items:         { type: 'array', items: { type: 'object' }, description: 'Line items: [{name, qty?, price?}].' },
          raw:           { type: 'string', description: 'Raw email/HTML/text for debugging + later LLM analysis.' },
        },
        required: ['source', 'merchant', 'order_date', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pair_transfers',
      description: 'Detect cross-account transfers (Spend → Reserve type) and link them with a transferGroupId so rollups don\'t double-count. Idempotent. Write.',
      parameters: {
        type: 'object',
        properties: { range_days: { type: 'number', description: 'Default 2.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_expense_report',
      description: 'Build an itemized expense report for a parent tag over a date range. Returns line items, totals by child tag and category, and links to attached receipts. Use this for "build an expense report for my Boise trip" kinds of requests.',
      parameters: {
        type: 'object',
        properties: {
          parent_tag:        { type: 'string', description: 'Name of the parent (primary) tag, e.g. "Work Travel - Boise May 2026". Case-insensitive, substring match falls back if exact name not found.' },
          from:              { type: 'string', description: 'Inclusive start date YYYY-MM-DD.' },
          to:                { type: 'string', description: 'Inclusive end date YYYY-MM-DD.' },
          include_inflows:   { type: 'boolean', description: 'Include positive (refund/reimbursement) txns. Default false.' },
        },
        required: ['parent_tag', 'from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_ambiguous_transfers',
      description: 'List outflows where the automatic transfer matcher abstained because multiple same-amount inflows on different accounts fall within the date window. Each group is one outflow + 2+ candidate inflows. Use to orchestrate manual review.',
      parameters: {
        type: 'object',
        properties: { range_days: { type: 'number', description: 'Date window in days (default 3).' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pair_transactions',
      description: 'Manually pair an outflow + inflow as a transfer. Both rows get the same transferGroupId and isTransfer=true so they\'re excluded from income/spending totals. Use after picking from list_ambiguous_transfers candidates. Write.',
      parameters: {
        type: 'object',
        properties: {
          outflow_id: { type: 'string' },
          inflow_id:  { type: 'string' },
        },
        required: ['outflow_id', 'inflow_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dismiss_pairing_candidates',
      description: 'Mark transactions as "not a transfer" so the auto-matcher stops suggesting them. Use when an ambiguous outflow is a real charge, or when none of the candidate inflows are the right match. Write.',
      parameters: {
        type: 'object',
        properties: {
          tx_ids: { type: 'array', items: { type: 'string' }, description: 'One or more transaction ids to dismiss from future pairing.' },
        },
        required: ['tx_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unpair_transfer',
      description: 'Undo a transfer pairing by transferGroupId. Both sides lose isTransfer and transferGroupId, becoming normal income/spending rows again. Write.',
      parameters: {
        type: 'object',
        properties: { transfer_group_id: { type: 'string' } },
        required: ['transfer_group_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'merchant_intel',
      description: 'Deep context on a merchant: every transaction (date/amount/account), total spend, first/last seen, monthly cadence, attached tags, linked subscription if any, related Order rows from email receipts, and suggested tags based on similar-merchant patterns. Use this BEFORE assigning a tag so you can reason about whether the merchant is a subscription, work expense, etc.',
      parameters: {
        type: 'object',
        properties: { merchant: { type: 'string', description: 'Normalized merchant name. Substring match falls back if not exact.' } },
        required: ['merchant'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'subscription_intel',
      description: 'Deep context on a recurring subscription: every charge, cadence, alias merchants, last/next estimates, status, attached tags, related orders. Use before tagging a subscription or any of its child transactions.',
      parameters: {
        type: 'object',
        properties: { subscription_id: { type: 'string' } },
        required: ['subscription_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transaction_intel',
      description: 'Deep context on a single transaction: full row + the account it lives on + the merchant\'s broader history (other charges, totals, cadence) + linked subscription + linked orders from email receipts + same-amount neighbors. Use before assigning tags or marking transfers.',
      parameters: {
        type: 'object',
        properties: { transaction_id: { type: 'string' } },
        required: ['transaction_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_transaction',
      description: 'Edit user-mutable fields on a transaction: notes, merchant name, or the isTransfer flag. Other fields (date, amount, account) are immutable from this tool - delete + recreate instead. Write.',
      parameters: {
        type: 'object',
        properties: {
          transaction_id: { type: 'string' },
          notes:       { type: 'string', description: 'Free-text user notes. Pass empty string to clear.' },
          merchant:    { type: 'string', description: 'Override the normalized merchant name.' },
          is_transfer: { type: 'boolean', description: 'Force-set isTransfer (excludes/includes in income+spending rollups).' },
        },
        required: ['transaction_id'],
      },
    },
  },
];

function parseDate(d?: string): Date | undefined {
  if (!d) return undefined;
  const t = new Date(d);
  return isNaN(+t) ? undefined : t;
}

export async function runBudgetTool(name: string, args: Record<string, any>): Promise<unknown> {
  const spaceId = await activeFinancialSpaceId();
  switch (name) {
    case 'list_transactions': {
      const flow = args.flow ?? 'outflow';
      const where: any = {};
      const date: any = {};
      if (parseDate(args.since)) date.gte = parseDate(args.since);
      if (parseDate(args.until)) date.lte = parseDate(args.until);
      if (Object.keys(date).length) where.date = date;
      if (flow === 'outflow') where.amount = { lt: 0 };
      if (flow === 'inflow') where.amount = { gt: 0 };
      if (args.merchant) where.merchant = { contains: args.merchant };
      if (args.category) where.category = { name: args.category };
      if (args.min_amount != null) where.amount = { ...(where.amount ?? {}), gte: -Math.abs(args.min_amount) };
      if (args.max_amount != null) where.amount = { ...(where.amount ?? {}), lte: -0 };
      const take = Math.min(500, Math.max(1, args.limit ?? 100));
      const rows = await prisma.transaction.findMany({
        where, take, orderBy: { date: 'desc' },
        select: { id: true, date: true, amount: true, merchant: true, rawDescription: true, category: { select: { name: true } } },
      });
      return rows.map(r => ({
        id: r.id, date: r.date.toISOString().slice(0, 10),
        amount: r.amount, merchant: r.merchant, description: r.rawDescription, category: r.category?.name ?? 'Other',
      }));
    }
    case 'list_subscriptions': {
      const status = args.status ?? 'active';
      const where = status === 'all' ? {} : { status };
      const subs = await prisma.subscription.findMany({
        where, orderBy: { amount: 'desc' },
        select: { id: true, merchant: true, amount: true, cadence: true, cadenceDays: true, firstSeen: true, lastSeen: true, nextEstimate: true, status: true, confidence: true },
      });
      return subs.map(s => ({
        ...s,
        firstSeen: s.firstSeen.toISOString().slice(0, 10),
        lastSeen: s.lastSeen.toISOString().slice(0, 10),
        nextEstimate: s.nextEstimate?.toISOString().slice(0, 10) ?? null,
        monthly_equivalent: +(s.amount * (30 / Math.max(1, s.cadenceDays))).toFixed(2),
      }));
    }
    case 'spend_by_category': {
      const date: any = {};
      if (parseDate(args.since)) date.gte = parseDate(args.since);
      if (parseDate(args.until)) date.lte = parseDate(args.until);
      if (!date.gte && args.window_days) {
        const d = new Date(); d.setDate(d.getDate() - args.window_days); date.gte = d;
      }
      const txs = await prisma.transaction.findMany({
        where: { amount: { lt: 0 }, isTransfer: false, ...(Object.keys(date).length ? { date } : {}) },
        select: { amount: true, category: { select: { name: true } } },
      });
      const totals = new Map<string, { total: number; count: number }>();
      for (const t of txs) {
        const key = t.category?.name ?? 'Other';
        const cur = totals.get(key) ?? { total: 0, count: 0 };
        cur.total += Math.abs(t.amount); cur.count += 1;
        totals.set(key, cur);
      }
      return [...totals.entries()]
        .map(([category, v]) => ({ category, total: +v.total.toFixed(2), count: v.count }))
        .sort((a, b) => b.total - a.total);
    }
    case 'monthly_summary': {
      const month = args.month as string;
      const [y, m] = month.split('-').map(Number);
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 1));
      const txs = await prisma.transaction.findMany({
        where: { date: { gte: start, lt: end }, isTransfer: false },
        select: { amount: true, category: { select: { name: true } } },
      });
      const inflow = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const outflow = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
      const byCat = new Map<string, number>();
      for (const t of txs) if (t.amount < 0) {
        const k = t.category?.name ?? 'Other';
        byCat.set(k, (byCat.get(k) ?? 0) + Math.abs(t.amount));
      }
      return {
        month, inflow: +inflow.toFixed(2), outflow: +outflow.toFixed(2), net: +(inflow - outflow).toFixed(2),
        top_categories: [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
          .map(([category, total]) => ({ category, total: +total.toFixed(2) })),
      };
    }
    case 'find_savings': {
      const status = args.status ?? 'open';
      const where = status === 'all' ? {} : { status };
      return prisma.recommendation.findMany({ where, orderBy: { monthlySavings: 'desc' } });
    }
    case 'search_merchant': {
      const m = args.merchant as string;
      const txs = await prisma.transaction.findMany({
        where: { merchant: { contains: m }, amount: { lt: 0 } },
        orderBy: { date: 'desc' },
        select: { date: true, amount: true, merchant: true },
      });
      if (!txs.length) return { merchant: m, count: 0 };
      const totals = txs.reduce((s, t) => s + Math.abs(t.amount), 0);
      return {
        merchant: m, count: txs.length,
        total_spend: +totals.toFixed(2),
        avg_per_charge: +(totals / txs.length).toFixed(2),
        first_seen: txs[txs.length - 1].date.toISOString().slice(0, 10),
        last_seen: txs[0].date.toISOString().slice(0, 10),
      };
    }
    case 'set_budget': {
      const { category, monthly } = args;
      if (category) {
        const cat = await prisma.category.findFirst({ where: { name: category } });
        if (!cat) return { error: `Unknown category: ${category}` };
        const existing = await prisma.budget.findFirst({ where: { categoryId: cat.id, scope: 'category' } });
        if (existing) return prisma.budget.update({ where: { id: existing.id }, data: { monthly } });
        return prisma.budget.create({ data: { categoryId: cat.id, scope: 'category', monthly } });
      }
      const existing = await prisma.budget.findFirst({ where: { scope: 'overall' } });
      if (existing) return prisma.budget.update({ where: { id: existing.id }, data: { monthly } });
      return prisma.budget.create({ data: { scope: 'overall', monthly } });
    }
    case 'assign_to_category': {
      const envelopeName = String(args.envelope ?? '').trim();
      if (!envelopeName) return { error: 'envelope name is required' };
      if (typeof args.amount !== 'number' || !Number.isFinite(args.amount)) return { error: 'amount (number) is required' };
      // A PRESENT-but-malformed month is an error (don't silently write to the
      // current month, as that would misallocate); absent month defaults.
      const my = resolveMonthArg(args.month);
      if ('error' in my) return my;
      const monthYear = my.monthYear;
      const mode = args.mode === 'delta' ? 'delta' : 'set';
      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
      const shapeEnv = (e: { id: string; monthYear: string; name: string; allocated: number; scope: string; rollover: boolean; tagId: string | null; categoryId: string | null }) =>
        ({ id: e.id, monthYear: e.monthYear, name: e.name, allocated: e.allocated, scope: e.scope, rollover: e.rollover, tagId: e.tagId, categoryId: e.categoryId });

      // Apply set/delta to an existing row. Factored out so the create-race
      // fallback (P2002) can reuse it.
      const applyToExisting = async (row: { id: string; allocated: number }) => {
        const next = mode === 'delta' ? row.allocated + args.amount : args.amount;
        if (next < 0) return { error: `Allocation can't go below 0 (would be ${next.toFixed(2)})` } as const;
        return { envelope: await prisma.envelope.update({ where: { id: row.id }, data: { allocated: round2(next) } }) } as const;
      };

      const existing = await prisma.envelope.findUnique({ where: { spaceId_monthYear_name: { spaceId, monthYear, name: envelopeName } } });
      let envelope;
      if (existing) {
        const r = await applyToExisting(existing);
        if ('error' in r) return r;
        envelope = r.envelope;
      } else {
        const amount = round2(args.amount);
        if (amount < 0) return { error: 'Cannot create an envelope with a negative allocation' };
        let createData: { spaceId: string; monthYear: string; name: string; allocated: number; scope: string; tagId?: string; categoryId?: string };
        if (args.category) {
          const cat = await prisma.category.findFirst({ where: { name: String(args.category) } });
          if (!cat) return { error: `Unknown category: ${args.category}` };
          createData = { spaceId, monthYear, name: envelopeName, allocated: amount, scope: 'category', categoryId: cat.id };
        } else if (args.tag) {
          const tags = await prisma.tag.findMany({ where: { name: String(args.tag) }, select: { id: true } });
          if (tags.length === 0) return { error: `Unknown tag: ${args.tag}` };
          if (tags.length > 1) return { error: `Tag name "${args.tag}" is ambiguous (${tags.length} matches) — create the envelope in the UI to disambiguate.` };
          createData = { spaceId, monthYear, name: envelopeName, allocated: amount, scope: 'tag', tagId: tags[0].id };
        } else {
          return { error: `Envelope "${envelopeName}" does not exist for ${monthYear}. Provide a tag or category to create it.` };
        }
        try {
          envelope = await prisma.envelope.create({ data: createData });
        } catch (e: any) {
          // Lost the create race against the @@unique([monthYear,name]) — a
          // concurrent caller (UI, retried request) created it first. Fall back
          // to updating that row so the allocation isn't silently dropped.
          if (String(e?.code) === 'P2002' || String(e?.message ?? '').includes('Unique constraint')) {
            const now = await prisma.envelope.findUnique({ where: { spaceId_monthYear_name: { spaceId, monthYear, name: envelopeName } } });
            if (!now) throw e;
            const r = await applyToExisting(now);
            if ('error' in r) return r;
            envelope = r.envelope;
          } else throw e;
        }
      }
      const readyToAssign = await getReadyToAssign(monthYear);
      return { envelope: shapeEnv(envelope), readyToAssign };
    }
    case 'ready_to_assign': {
      const my = resolveMonthArg(args.month);
      if ('error' in my) return my;
      return getReadyToAssign(my.monthYear);
    }
    case 'forecast_summary': {
      const { projectCashflow } = await import('./cashflowProjection');
      const proj = await projectCashflow(90);
      const overall = await prisma.forecast.findFirst({
        where: { scope: 'overall', method: 'composite', flow: 'outflow' },
        orderBy: { generatedAt: 'desc' }, include: { points: { orderBy: { month: 'asc' } } },
      });
      const income = await prisma.forecast.findFirst({
        where: { scope: 'overall', method: 'composite', flow: 'inflow' },
        orderBy: { generatedAt: 'desc' }, include: { points: { orderBy: { month: 'asc' } } },
      });
      const net = await prisma.forecast.findFirst({
        where: { scope: 'overall', method: 'composite', flow: 'net' },
        orderBy: { generatedAt: 'desc' }, include: { points: { orderBy: { month: 'asc' } } },
      });
      const sum = (f: typeof overall) => f?.points.reduce((s, p) => s + p.point, 0) ?? 0;
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const monthly = (income?.points ?? []).map((p, i) => ({
        month: p.month.toISOString().slice(0, 7),
        income: r2(p.point),
        spending: r2(overall?.points[i]?.point ?? 0),
        net: r2(net?.points[i]?.point ?? (p.point - (overall?.points[i]?.point ?? 0))),
      }));
      return {
        cash90d: {
          startBalance: r2(proj.start.balance),
          lowWater: { balance: r2(proj.lowWater.balance), date: proj.lowWater.dateISO },
          totalIn: r2(proj.totalIn), totalOut: r2(proj.totalOut),
          recurringInflowsDetected: proj.recurringInflowsDetected,
        },
        forecast12mo: overall
          ? {
              generatedAt: overall.generatedAt.toISOString(),
              projectedIncome: r2(sum(income)),
              projectedSpending: r2(sum(overall)),
              projectedNet: r2(sum(income) - sum(overall)),
              monthly,
            }
          : { note: 'No long-range forecast generated yet. Generate one on the Forecast page.' },
      };
    }
    case 'recent_activity': {
      const limit = Math.max(1, Math.min(200, typeof args.limit === 'number' ? args.limit : 25));
      const where = args.writes_only === true ? { isWrite: true } : {};
      const rows = await prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, take: limit });
      return rows.map(r => ({
        at: r.at.toISOString(), surface: r.surface, actor: r.actor,
        tool: r.tool, isWrite: r.isWrite, ok: r.ok, error: r.error ?? undefined,
      }));
    }
    case 'suggest_rules': {
      const { suggestRules } = await import('./suggestRules');
      return suggestRules();
    }
    case 'holdings_summary': {
      const { holdingsSummary } = await import('./holdings');
      return holdingsSummary();
    }
    case 'financial_statements': {
      const { buildStatements, resolvePeriod } = await import('./statements');
      const today = new Date();
      const toStr = typeof args.to === 'string' && args.to ? args.to : today.toISOString().slice(0, 10);
      const fromStr = typeof args.from === 'string' && args.from
        ? args.from
        : new Date(+today - 90 * 86400000).toISOString().slice(0, 10);
      try {
        const { from, to } = resolvePeriod(fromStr, toStr);
        return buildStatements({ from, to });
      } catch (e: any) {
        return { error: e?.message ?? String(e) };
      }
    }
    case 'schedule_summary': {
      const { monthlyCommitments, upcomingEvents } = await import('./schedule');
      const [commitments, upcoming] = await Promise.all([monthlyCommitments(), upcomingEvents(60)]);
      return { commitments, upcoming };
    }
    case 'create_schedule': {
      const name = String(args.name ?? '').trim();
      if (!name) return { error: 'name is required' };
      if (typeof args.amount !== 'number' || !Number.isFinite(args.amount) || args.amount === 0) return { error: 'amount (non-zero; negative = expense) is required' };
      const cadenceDays = Math.max(1, Math.round(typeof args.cadence_days === 'number' ? args.cadence_days : 30));
      const nextDate = args.next_date ? new Date(String(args.next_date)) : new Date();
      if (isNaN(nextDate.getTime())) return { error: 'next_date is invalid' };
      return prisma.schedule.create({ data: { name: name.slice(0, 120), amount: Math.round(args.amount * 100) / 100, cadenceDays, nextDate } });
    }
    case 'refresh_prices': {
      const { refreshHoldingPrices } = await import('./securityPrices');
      return refreshHoldingPrices();
    }
    case 'scenario_runway': {
      const { runwayWithDeltas } = await import('./scenarios');
      const deltas = Array.isArray(args.deltas) ? args.deltas.filter((d: unknown): d is number => typeof d === 'number' && Number.isFinite(d)) : [];
      const r = await runwayWithDeltas(deltas);
      return {
        liquidSavings: r.liquidStart,
        baselineMonthlyNet: r.baseMonthlyNet,
        appliedDelta: r.appliedDelta,
        monthlyNet: r.monthlyNet,
        status: r.status,
        runwayMonths: r.runwayMonths,
        depletionDate: r.depletionDate,
        annualChange: r.annualChange,
        baselineSource: r.source,
      };
    }
    case 'debt_payoff_plan': {
      const { buildDebtPlan } = await import('./debt');
      const budget = typeof args.monthly_budget === 'number' && Number.isFinite(args.monthly_budget) && args.monthly_budget >= 0
        ? args.monthly_budget : undefined;
      const plan = await buildDebtPlan(budget);
      if (!plan.comparison) {
        return {
          debts: plan.accounts.map(a => ({ name: a.name, balance: a.balance, apr: a.apr, minimumPayment: a.minimumPayment, hasInputs: a.hasInputs })),
          note: plan.accounts.length === 0
            ? 'No credit/loan accounts with a balance.'
            : `${plan.missingInputs} debt(s) need an APR + minimum payment set before a plan can be computed.`,
        };
      }
      const c = plan.comparison;
      const slim = (p: typeof c.avalanche) => ({
        feasible: p.feasible, reason: p.reason, months: p.months,
        totalInterest: p.totalInterest, totalPaid: p.totalPaid,
        order: p.order.map(s => ({ name: s.name, payoffMonth: s.payoffMonth, interestPaid: s.interestPaid })),
      });
      return {
        monthlyBudget: c.monthlyBudget,
        totalBalance: c.totalBalance,
        totalMinimums: c.totalMinimums,
        recommended: c.recommended,
        interestSavedByAvalanche: c.interestSavedByAvalanche,
        monthsDifference: c.monthsDifference,
        avalanche: slim(c.avalanche),
        snowball: slim(c.snowball),
        missingInputs: plan.missingInputs,
      };
    }
    case 'reconciliation_status': {
      const resolved = await resolveAccountRef(String(args.account ?? ''));
      if ('error' in resolved) return { error: resolved.error };
      const state = await getReconcileState(resolved.account.id);
      if (!state) return { error: 'Account not found' };
      // Return the summary (counts + balances) — NOT the 500-row tx window,
      // which would blow up the MCP response. Agents drill in via list_transactions.
      return {
        account: { id: state.account.id, name: state.account.name, currency: state.account.currency },
        bookBalance: state.bookBalance,
        clearedBalance: state.clearedBalance,
        reconciledBalance: state.reconciledBalance,
        clearedUnlockedSum: state.clearedUnlockedSum,
        clearedCount: state.clearedCount,
        lockedCount: state.lockedCount,
        unlockedClearedCount: state.unlockedClearedCount,
        olderUnclearedCount: state.olderUnclearedCount,
        reconciledAsOf: state.account.reconciledAsOf?.toISOString() ?? null,
      };
    }
    case 'connection_health': {
      const where: { id?: string | { in: string[] } } = {};
      const filterRef = args.institution ? String(args.institution).trim() : '';
      if (filterRef) {
        if (CUID_RE.test(filterRef)) {
          where.id = filterRef;
        } else {
          // Name filter: exact then case-insensitive contains (literal, in JS to
          // avoid LIKE-wildcard surprises). Error if nothing matches a non-empty
          // filter, rather than silently returning [].
          const all = await prisma.institution.findMany({ select: { id: true, name: true } });
          const lc = filterRef.toLowerCase();
          let hits = all.filter(i => i.name.toLowerCase() === lc);
          if (hits.length === 0) hits = all.filter(i => i.name.toLowerCase().includes(lc));
          if (hits.length === 0) return { error: `No institution matches "${filterRef}".` };
          where.id = { in: hits.map(h => h.id) };
        }
      }
      const insts = await prisma.institution.findMany({
        where,
        select: { id: true, name: true, source: true, accessToken: true, lastSyncedAt: true, lastSyncStatus: true, lastSyncError: true },
        orderBy: { name: 'asc' },
      });
      return insts.map(i => {
        const badge = healthBadge(i);
        return {
          id: i.id, name: i.name, source: i.source,
          lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
          status: i.lastSyncStatus ?? 'never',
          lastError: i.lastSyncError ?? null,
          badge: badge.label, detail: badge.detail,
        };
      });
    }
    case 'mark_cleared': {
      const id = String(args.transaction_id ?? '');
      if (!id) return { error: 'transaction_id is required' };
      if (typeof args.cleared !== 'boolean') return { error: 'cleared (boolean) is required' };
      const data: { cleared: boolean; reconciledAt?: null } = { cleared: args.cleared };
      // Un-clearing must drop any reconciliation lock so the cleared balance
      // can't double-count it (mirrors the PATCH /api/transactions/:id rule).
      if (args.cleared === false) data.reconciledAt = null;
      try {
        const t = await prisma.transaction.update({ where: { id }, data, select: { id: true, cleared: true, reconciledAt: true, amount: true } });
        return { id: t.id, cleared: t.cleared, reconciledAt: t.reconciledAt?.toISOString() ?? null, amount: t.amount };
      } catch {
        return { error: `No transaction with id ${id}` };
      }
    }
    case 'reconcile_account': {
      // Destructive (locks rows, can create an adjustment) → strict account
      // resolution: exact id or exact name only, never a fuzzy match.
      const resolved = await resolveAccountRef(String(args.account ?? ''), { strict: true });
      if ('error' in resolved) return { error: resolved.error };
      if (typeof args.statement_balance !== 'number' || !Number.isFinite(args.statement_balance)) {
        return { error: 'statement_balance (number) is required' };
      }
      const statementDate = args.statement_date ? new Date(String(args.statement_date)) : new Date();
      if (isNaN(statementDate.getTime())) return { error: 'statement_date is not a valid date' };
      // Only a real JSON boolean true enables the ledger write — guard against
      // truthy coercions like the string "false" or 1.
      const createAdjustment = args.create_adjustment === true;
      const acctId = resolved.account.id;

      const state = await getReconcileState(acctId);
      if (!state) return { error: 'Account not found' };
      const diff = reconcileDifference(args.statement_balance, state.clearedBalance);
      let adjustmentId: string | null = null;

      if (!tiesOut(diff)) {
        if (!createAdjustment) {
          return {
            ok: false, code: 'OUT_OF_BALANCE',
            difference: diff, clearedBalance: state.clearedBalance, statementBalance: args.statement_balance,
            hint: 'Mark the right rows cleared (mark_cleared) so the cleared balance matches, or re-call with create_adjustment=true to book the residual as a balancing entry.',
          };
        }
        // Deterministic hash → a retry with the same account+date+residual
        // collides on the @unique hash instead of double-booking.
        const adjHash = `reconcile-adj-${acctId}-${statementDate.toISOString().slice(0, 10)}-${diff.toFixed(2)}`;
        try {
          const adj = await prisma.transaction.create({
            data: {
              accountId: acctId, hash: adjHash, date: statementDate, amount: diff,
              rawDescription: 'Reconciliation adjustment', merchant: 'Reconciliation adjustment',
              cleared: true,
              notes: `Balancing entry created via MCP reconcile_account to ${args.statement_balance.toFixed(2)} on ${statementDate.toISOString().slice(0, 10)}.`,
            },
            select: { id: true },
          });
          adjustmentId = adj.id;
        } catch (e: any) {
          if (String(e?.code) === 'P2002' || String(e?.message ?? '').includes('Unique constraint')) {
            const prior = await prisma.transaction.findUnique({ where: { hash: adjHash }, select: { id: true } });
            adjustmentId = prior?.id ?? null; // an adjustment with this date+amount already exists
          } else throw e;
        }
        // Re-verify the books actually tie out now. A fresh adjustment balances
        // by construction; but a P2002 hash collision (a DIFFERENT reconciliation
        // whose residual coincidentally rounded to the same amount on the same
        // date) means no NEW balancing row was booked — so refuse to lock an
        // account that is still out of balance rather than falsely report ok.
        const after = await getReconcileState(acctId);
        const afterDiff = after ? reconcileDifference(args.statement_balance, after.clearedBalance) : diff;
        if (!tiesOut(afterDiff)) {
          return {
            ok: false, code: 'OUT_OF_BALANCE',
            difference: afterDiff, clearedBalance: after?.clearedBalance, statementBalance: args.statement_balance,
            hint: 'A reconciliation adjustment for this date and amount already exists but does not balance the current cleared total. Resolve the existing adjustment or reconcile with a different statement date.',
          };
        }
      }

      // Lock + record as-of atomically. Scope the lock to bank-statement lines
      // (parents + unsplit rows; exclude split children) so we never lock an
      // internal split child.
      const now = new Date();
      const locked = await prisma.$transaction(async tx => {
        const result = await tx.transaction.updateMany({
          where: { accountId: acctId, parentTransactionId: null, cleared: true, reconciledAt: null },
          data: { reconciledAt: now },
        });
        await tx.bankAccount.update({ where: { id: acctId }, data: { reconciledAsOf: statementDate } });
        return result;
      });
      return {
        ok: true, account: resolved.account.name,
        lockedCount: locked.count, adjustmentId,
        reconciledAsOf: statementDate.toISOString(), statementBalance: args.statement_balance,
      };
    }
    case 'sync_now': {
      const { isVaultUnlocked } = await import('./vault');
      if (!isVaultUnlocked()) {
        return { error: 'Vault is locked — sync_now needs the encryption vault unlocked to decrypt connector credentials. Sign in (or set MASTER_KEY) first.' };
      }
      const { runInstitutionSync } = await import('./syncRunner');
      return runInstitutionSync({
        institutionId: typeof args.institution === 'string' ? args.institution : undefined,
        sinceDays: typeof args.since_days === 'number' ? args.since_days : undefined,
      });
    }
    case 'mark_subscription': {
      const { subscription_id, status } = args;
      return prisma.subscription.update({ where: { id: subscription_id }, data: { status } });
    }
    case 'top_merchants_in_category': {
      const sinceDays = args.since_days ?? 30;
      const limit = Math.min(50, args.limit ?? 5);
      const since = new Date(Date.now() - sinceDays * 86400000);
      const txs = await prisma.transaction.findMany({
        where: { date: { gte: since }, amount: { lt: 0 }, isTransfer: false, category: { name: args.category } },
        select: { merchant: true, amount: true },
      });
      const map = new Map<string, { total: number; count: number }>();
      for (const t of txs) {
        const k = t.merchant ?? 'Unknown';
        const cur = map.get(k) ?? { total: 0, count: 0 };
        cur.total += Math.abs(t.amount); cur.count += 1;
        map.set(k, cur);
      }
      return [...map.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, limit)
        .map(([merchant, v]) => ({ merchant, total: +v.total.toFixed(2), count: v.count, avg: +(v.total / v.count).toFixed(2) }));
    }
    case 'subscription_cancel_impact': {
      const s = await prisma.subscription.findUnique({ where: { id: args.subscription_id } });
      if (!s) return { error: 'Subscription not found' };
      const monthly = s.amount * (30 / Math.max(1, s.cadenceDays));
      return { merchant: s.merchant, monthly: +monthly.toFixed(2), annual: +(monthly * 12).toFixed(2) };
    }
    case 'simulate_change': {
      const active = await prisma.plan.findFirst({ where: { status: 'active' }, include: { lines: true } });
      if (!active) return { error: 'No active plan' };
      const newMonthly = args.new_monthly_target as number;
      const linesByCat = active.lines.filter(l => l.scope === 'category' && l.scopeKey === args.category);
      const oldPerMonth = linesByCat.length ? linesByCat.reduce((s, l) => s + l.amount, 0) / linesByCat.length : 0;
      const delta = (newMonthly - oldPerMonth) * linesByCat.length;
      const oldTotal = active.lines.reduce((s, l) => s + l.amount, 0);
      return { category: args.category, oldMonthly: +oldPerMonth.toFixed(2), newMonthly: +newMonthly.toFixed(2),
               oldPlanTotal: +oldTotal.toFixed(2), newPlanTotal: +(oldTotal + delta).toFixed(2),
               deltaTotal: +delta.toFixed(2) };
    }
    case 'checkpoint': {
      const { runCheckpoint } = await import('./checkpoint');
      const period = (args.period === 'quarter' || args.period === 'ytd') ? args.period : 'month';
      return runCheckpoint({ period });
    }

    // ===== Phase 4 agent surface =====

    case 'list_accounts': {
      const accounts = await prisma.bankAccount.findMany({
        include: { institution: { select: { name: true, source: true } } },
        orderBy: { name: 'asc' },
      });
      return accounts.map(a => ({
        id: a.id, uuid: undefined, // future
        name: a.name, mask: a.mask,
        type: a.type, kind: a.kind,
        institution: a.institution.name,
        source: a.institution.source,
        balance: a.balance, balanceAsOf: a.balanceAsOf?.toISOString() ?? null,
        currency: a.currency,
      }));
    }

    case 'account_balance': {
      const a = await prisma.bankAccount.findUnique({ where: { id: args.account_id } });
      if (!a) return { error: 'Account not found' };
      return { id: a.id, name: a.name, balance: a.balance, balanceAsOf: a.balanceAsOf?.toISOString() ?? null, currency: a.currency };
    }

    case 'net_worth': {
      const { isAsset, resolvedKind } = await import('./accountKind');
      const accounts = await prisma.bankAccount.findMany({ include: { institution: true } });
      let assets = 0, liabilities = 0;
      const byKind: Record<string, { total: number; count: number }> = {};
      for (const a of accounts) {
        const k = resolvedKind(a);
        const bal = a.balance ?? 0;
        if (isAsset(k)) assets += bal; else liabilities += bal;
        if (!byKind[k]) byKind[k] = { total: 0, count: 0 };
        byKind[k].total += bal; byKind[k].count += 1;
      }
      return {
        assets: +assets.toFixed(2),
        liabilities: +Math.abs(liabilities).toFixed(2),
        net_worth: +(assets - Math.abs(liabilities)).toFixed(2),
        by_kind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { total: +v.total.toFixed(2), count: v.count }])),
      };
    }

    case 'list_tags': {
      const tags = await prisma.tag.findMany({
        include: { parent: { select: { name: true } } },
        orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      });
      return tags.map(t => ({
        id: t.id, uuid: t.uuid, name: t.name, color: t.color,
        kind: t.kind, parent: t.parent?.name ?? null,
      }));
    }

    case 'create_tag': {
      const kind: 'primary' | 'secondary' = args.kind === 'primary' ? 'primary' : 'secondary';
      const data: any = { name: args.name, kind };
      if (args.color) data.color = args.color;
      if (args.parent_name) {
        const parent = await prisma.tag.findFirst({ where: { name: args.parent_name, parentId: null } });
        if (!parent) return { error: `Parent tag not found: ${args.parent_name}` };
        data.parentId = parent.id;
      }
      // Secondaries must have a parent. If the LLM didn't pick one, drop the
      // tag into the catch-all Modifier primary so the invariant holds.
      if (kind === 'secondary' && !data.parentId) {
        const { ensureModifierParent } = await import('./tags');
        data.parentId = await ensureModifierParent();
      }
      try {
        const t = await prisma.tag.create({ data });
        return { ok: true, tag: { id: t.id, uuid: t.uuid, name: t.name, kind: t.kind, parentId: t.parentId } };
      } catch (err) {
        return { error: (err as Error).message };
      }
    }

    case 'attach_tags': {
      const refs: string[] = Array.isArray(args.tag_names) ? args.tag_names : [];
      if (refs.length === 0) return { error: 'tag_names must be a non-empty array' };
      const resolved = await resolveTagRefs(refs);
      if (resolved.ambiguous.length > 0) {
        return {
          error: 'Ambiguous tag name(s) - resubmit with the specific id from candidates below. Use the cuid (not the uuid) for tag_names if you only want to disambiguate one.',
          ambiguous: resolved.ambiguous,
        };
      }
      if (resolved.tags.length === 0) {
        return { error: 'No matching tags found', unknown: resolved.unknown };
      }
      // Normalizer enforces single-primary + child-supersedes-parent rules
      // so the LLM can't pile multiple primaries or parent+child stacks onto
      // a transaction by accident.
      const { attachTagsNormalized, propagateTagsByMerchant } = await import('./tags');
      const r = await attachTagsNormalized({
        transactionId: args.transaction_id,
        tagIds: resolved.tags.map(t => t.id),
      });
      const propagated = await propagateTagsByMerchant(args.transaction_id);
      const idToName = new Map(resolved.tags.map(t => [t.id, t.name]));
      const removedFromCatalog = r.removed.length
        ? await prisma.tag.findMany({ where: { id: { in: r.removed } }, select: { id: true, name: true } })
        : [];
      return {
        ok: true,
        attached: r.added.map(id => ({ id, name: idToName.get(id) ?? id })),
        removed_by_normalizer: removedFromCatalog.map(t => ({ id: t.id, name: t.name })),
        unknown: resolved.unknown,
        propagated,
      };
    }

    case 'detach_tag': {
      const ref: string = args.tag_name;
      if (typeof ref !== 'string' || !ref) return { error: 'tag_name required' };
      const resolved = await resolveTagRefs([ref]);
      if (resolved.ambiguous.length > 0) {
        return {
          error: 'Ambiguous tag name - resubmit with the specific id from candidates below.',
          ambiguous: resolved.ambiguous,
        };
      }
      if (resolved.tags.length === 0) return { error: `Tag not found: ${ref}` };
      const tag = resolved.tags[0];
      await prisma.transaction.update({
        where: { id: args.transaction_id },
        data: { tags: { disconnect: { id: tag.id } } },
      });
      return { ok: true, detached: { id: tag.id, name: tag.name } };
    }

    case 'update_tag': {
      const ref: string | undefined = args.id ?? args.current_name;
      if (!ref) return { error: 'Provide id or current_name' };
      const resolved = await resolveTagRefs([ref]);
      if (resolved.ambiguous.length > 0) {
        return {
          error: 'Ambiguous current_name - resubmit with the specific id from candidates below.',
          ambiguous: resolved.ambiguous,
        };
      }
      if (resolved.tags.length === 0) return { error: `Tag not found: ${ref}` };
      const target = resolved.tags[0];
      const previousName = target.name;

      const data: Record<string, unknown> = {};

      // new_name: reject if it would collide with a different tag.
      if (typeof args.new_name === 'string' && args.new_name.trim() !== '' && args.new_name.trim() !== previousName) {
        const proposed = args.new_name.trim();
        const collision = await prisma.tag.findFirst({
          where: { name: proposed, id: { not: target.id } },
          select: { id: true, name: true, parent: { select: { name: true } } },
        });
        if (collision) {
          return {
            error: 'Name already in use',
            conflicting_tag: {
              id: collision.id,
              name: collision.name,
              parent: collision.parent?.name ?? null,
            },
          };
        }
        data.name = proposed;
      }

      if (args.color === null) data.color = null;
      else if (typeof args.color === 'string') data.color = args.color;

      if (args.kind === 'primary' || args.kind === 'secondary') data.kind = args.kind;

      // Parent change: parent_id wins over parent_name. null clears.
      if (args.parent_id !== undefined || args.parent_name !== undefined) {
        if (args.parent_id === null || args.parent_name === null) {
          data.parentId = null;
        } else {
          const pref = (args.parent_id as string | undefined) ?? (args.parent_name as string | undefined);
          if (typeof pref === 'string') {
            const pres = await resolveTagRefs([pref]);
            if (pres.unknown.length > 0) return { error: `Parent not found: ${pref}` };
            if (pres.ambiguous.length > 0) {
              return { error: 'Ambiguous parent name', ambiguous: pres.ambiguous };
            }
            const newParentId = pres.tags[0].id;
            if (newParentId === target.id) return { error: 'Cannot parent to self' };
            // Cycle check: the proposed parent must not itself be a descendant
            // of the target. Walk up the chain.
            let cursor: string | null = newParentId;
            const visited = new Set<string>();
            while (cursor) {
              if (visited.has(cursor)) break;
              visited.add(cursor);
              if (cursor === target.id) return { error: 'Cycle detected' };
              const row: { parentId: string | null } | null = await prisma.tag.findUnique({
                where: { id: cursor }, select: { parentId: true },
              });
              cursor = row?.parentId ?? null;
            }
            data.parentId = newParentId;
          }
        }
      }

      if (Object.keys(data).length === 0) return { error: 'No editable fields provided' };

      // Enforce: secondaries must have a parent. If the patch leaves the row
      // as an orphan secondary, auto-route to Modifier.
      const current = await prisma.tag.findUnique({
        where: { id: target.id },
        select: { kind: true, parentId: true },
      });
      if (!current) return { error: 'Tag disappeared mid-update' };
      const finalKind = ((data.kind as string | undefined) ?? current.kind) as 'primary' | 'secondary';
      const finalParentId = ('parentId' in data ? data.parentId : current.parentId) as string | null;
      if (finalKind === 'secondary' && !finalParentId) {
        const { ensureModifierParent } = await import('./tags');
        data.parentId = await ensureModifierParent();
      }

      const updated = await prisma.tag.update({
        where: { id: target.id },
        data,
        include: { parent: { select: { name: true } } },
      });
      const affectedTransactions = await prisma.transaction.count({
        where: { tags: { some: { id: target.id } } },
      });
      return {
        ok: true,
        tag: {
          id: updated.id,
          uuid: updated.uuid,
          name: updated.name,
          color: updated.color,
          kind: updated.kind,
          parent: updated.parent?.name ?? null,
        },
        previousName: previousName !== updated.name ? previousName : undefined,
        affectedTransactions,
      };
    }

    case 'add_transaction': {
      const { txnHash } = await import('./hash');
      const { normalizeMerchant } = await import('./merchant');
      const { categorize } = await import('./categorize');
      const date = new Date((args.date as string) + 'T00:00:00Z');
      if (Number.isNaN(+date)) return { error: 'Invalid date' };
      const rawDescription = (args.description as string).trim().slice(0, 500);
      const merchant = args.merchant ? normalizeMerchant(args.merchant as string) : normalizeMerchant(rawDescription);
      const amount = Number(args.amount);
      if (Number.isNaN(amount)) return { error: 'amount must be a number' };
      const hash = txnHash({ accountId: args.account_id, date, amount, rawDescription });
      const categoryName = categorize(merchant, rawDescription, amount);
      const cat = await prisma.category.findFirst({ where: { name: categoryName } });
      try {
        const tx = await prisma.transaction.create({
          data: {
            accountId: args.account_id, date, amount,
            rawDescription, merchant,
            categoryId: cat?.id ?? null,
            hash, isTransfer: categoryName === 'Transfers',
          },
        });
        // Optional tags
        if (Array.isArray(args.tag_names) && args.tag_names.length > 0) {
          const tags = await prisma.tag.findMany({ where: { name: { in: args.tag_names } } });
          if (tags.length > 0) {
            await prisma.transaction.update({
              where: { id: tx.id }, data: { tags: { connect: tags.map(t => ({ id: t.id })) } },
            });
          }
        }
        return { ok: true, id: tx.id, uuid: tx.uuid };
      } catch (err) {
        return { error: (err as Error).message };
      }
    }

    case 'search_transactions': {
      const q = (args.query as string).trim();
      if (!q) return [];
      const take = Math.min(200, Math.max(1, args.limit ?? 50));
      const rows = await prisma.transaction.findMany({
        where: {
          OR: [
            { merchant:       { contains: q } },
            { rawDescription: { contains: q } },
            { notes:          { contains: q } },
          ],
        },
        orderBy: { date: 'desc' }, take,
        include: { account: { select: { name: true } }, category: { select: { name: true } } },
      });
      return rows.map(r => ({
        id: r.id, uuid: r.uuid,
        date: r.date.toISOString().slice(0, 10),
        amount: r.amount,
        merchant: r.merchant, description: r.rawDescription,
        account: r.account.name, category: r.category?.name ?? 'Other',
      }));
    }

    case 'hunt_transaction': {
      const { huntTransaction } = await import('./huntTransaction');
      return huntTransaction(args.transaction_id);
    }

    case 'ingest_order': {
      const data: any = {
        spaceId,
        source: args.source,
        merchant: args.merchant,
        orderDate: new Date((args.order_date as string) + 'T00:00:00Z'),
        amount: Math.abs(Number(args.amount)),
      };
      if (args.external_id) data.externalId = args.external_id;
      if (args.url) data.url = args.url;
      if (Array.isArray(args.items)) data.items = JSON.stringify(args.items);
      if (args.raw)  data.raw = (args.raw as string).slice(0, 50_000);
      try {
        const order = await prisma.order.create({ data });
        return { ok: true, id: order.id };
      } catch (err) {
        // Probably a unique constraint hit on (source, externalId) - return existing.
        const existing = args.external_id
          ? await prisma.order.findUnique({ where: { spaceId_source_externalId: { spaceId, source: args.source, externalId: args.external_id } } }).catch(() => null)
          : null;
        return { ok: false, error: (err as Error).message, existing: existing?.id ?? null };
      }
    }

    case 'pair_transfers': {
      const { pairCrossAccountTransfers } = await import('./transferPairing');
      return pairCrossAccountTransfers({ rangeDays: args.range_days });
    }

    case 'generate_expense_report': {
      const report = await buildExpenseReport({
        parentTag: String(args.parent_tag ?? ''),
        from: String(args.from ?? ''),
        to: String(args.to ?? ''),
        includeInflows: args.include_inflows === true,
      });
      // Build absolute URLs for receipts so external agents can fetch them.
      const base = process.env.AUTH_URL || process.env.NEXTAUTH_URL || '';
      const items = report.items.map(it => ({
        ...it,
        receipts: it.receipts.map(r => ({ ...r, url: base ? `${base}${r.url}` : r.url })),
      }));
      return {
        parent_tag: report.parentTag,
        range: report.range,
        generated_at: report.generatedAt,
        total: report.totalAbs,
        currency: report.currency,
        receipt_count: report.receiptCount,
        by_child_tag: report.byChildTag,
        by_category: report.byCategory,
        items,
        printable_url: base ? `${base}/reports/expense?tag=${encodeURIComponent(report.parentTag.name)}&from=${report.range.from}&to=${report.range.to}` : null,
      };
    }

    case 'list_ambiguous_transfers': {
      const { findAmbiguousTransfers } = await import('./transferReview');
      const groups = await findAmbiguousTransfers({ rangeDays: args.range_days });
      return { total: groups.length, groups };
    }
    case 'pair_transactions': {
      const { pairTransactionsManual } = await import('./transferReview');
      await pairTransactionsManual(String(args.outflow_id), String(args.inflow_id));
      return { ok: true };
    }
    case 'dismiss_pairing_candidates': {
      const { dismissPairingCandidates } = await import('./transferReview');
      const ids = Array.isArray(args.tx_ids) ? args.tx_ids.map(String) : [];
      const r = await dismissPairingCandidates(ids);
      return { ok: true, ...r };
    }
    case 'unpair_transfer': {
      const { unpairTransfer } = await import('./transferReview');
      const r = await unpairTransfer(String(args.transfer_group_id));
      return { ok: true, ...r };
    }
    case 'merchant_intel': {
      const { merchantIntel } = await import('./entityIntel');
      return merchantIntel(String(args.merchant ?? ''));
    }
    case 'subscription_intel': {
      const { subscriptionIntel } = await import('./entityIntel');
      return subscriptionIntel(String(args.subscription_id ?? ''));
    }
    case 'transaction_intel': {
      const { transactionIntel } = await import('./entityIntel');
      return transactionIntel(String(args.transaction_id ?? ''));
    }
    case 'update_transaction': {
      const data: Record<string, unknown> = {};
      if (typeof args.notes === 'string') data.notes = args.notes || null;
      if (typeof args.merchant === 'string') data.merchant = args.merchant.trim();
      if (typeof args.is_transfer === 'boolean') data.isTransfer = args.is_transfer;
      if (Object.keys(data).length === 0) return { error: 'No editable fields provided. Use notes, merchant, or is_transfer.' };
      try {
        const tx = await prisma.transaction.update({
          where: { id: String(args.transaction_id) },
          data,
          select: { id: true, notes: true, merchant: true, isTransfer: true },
        });
        return { ok: true, transaction: tx };
      } catch (e: any) {
        return { error: e?.message ?? String(e) };
      }
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// Uniform wrapper: always resolves to `{ ok: true, result }` or
// `{ ok: false, error }`. Callers that already handle thrown errors (chat
// route, MCP server) can keep using runBudgetTool directly; new callers
// (server actions, REST adapters, future audit middleware) should prefer
// this surface so behavior is consistent across call sites.
export async function runBudgetToolSafe(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  try {
    const result = await runBudgetTool(name, args);
    if (result && typeof result === 'object' && 'error' in result && typeof (result as { error?: unknown }).error === 'string') {
      return { ok: false, error: (result as { error: string }).error };
    }
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? String(err) };
  }
}
