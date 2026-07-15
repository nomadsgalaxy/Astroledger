# Astroledger

Powerful, self-hosted personal-finance software for individuals and households. Astroledger connects accounts and imports, turns them into a clean ledger, explains current and recurring activity, supports budgets, forecasts and plans, and answers questions through a local LLM. Its goal is to cover a person's full financial life without surrendering that data to a hosted finance platform. Production data, receipt files, and backups are encrypted at rest, with an additional field-encryption layer for credentials and raw provider data.

## Personal, shared, and generational finances

Every person gets a private financial space alongside any shared household spaces. Accounts remain owned by one space and can be shared individually or in bulk with view, manage, document, export, and resharing capabilities. Trusted helpers and advisors can be invited without becoming household members.

Stewarded spaces support a child or dependent while preserving one continuous ledger as they gain autonomy. Ownership can be transferred directly, or through an explicit succession plan with nominated successors, approval quorum, and a waiting period. Inactivity alone never triggers succession. The global space switcher applies the same boundary to accounts, transactions, budgets, plans, reports, documents, and exports.

Households can also split real charges across members (equal, percentage, or fixed shares) and settle them against linked reimbursements without double-counting; stewarded spaces support recurring allowances and reward chores with guardian approval. Every permission, sharing, ownership, and succession change lands in an append-only per-space audit trail, and affected members get in-app notifications.

> **Current version: 0.8.1.** Try the live demo with generated data at <https://demo.astroledger.app>.

---

## Setup — from zero to running, end to end

This walks you through every step. If anything's unclear, the troubleshooting section at the bottom probably has it.

### 1. Prerequisites

| Tool | Min version | Check |
|---|---|---|
| Node.js | 20.x (24.x recommended) | `node --version` |
| npm | 10.x | `npm --version` |
| Git | 2.30+ | `git --version` |
| OpenSSL or PowerShell | for generating keys | `openssl version` or `Get-Command New-Guid` |

Docker is optional — used for the local LLM and for production deploys. Skip it on first pass.

### 2. Clone + install

```bash
git clone https://github.com/<you>/astroledger.git
cd astroledger
npm install
```

If you pulled the release zip instead, unzip it, `cd astroledger-0.2.1`, then `npm install`.

### 3. Create `.env`

```bash
cp .env.example .env       # macOS / Linux / Git Bash
# OR on PowerShell:
Copy-Item .env.example .env
```

Open `.env` in your editor. The fields you MUST fill in to boot:

| Variable | What | How to generate |
|---|---|---|
| `MASTER_KEY` | AES-256-GCM key for field encryption + WebAuthn challenges. 64 hex chars. | `openssl rand -hex 32` |
| `AUTH_SECRET` | NextAuth signing secret. | `openssl rand -base64 32` |
| `AUTH_URL` | Public origin Astroledger will be served from. | `http://localhost:5050` for dev, `https://astroledger.example.com` for prod |
| `ALLOWED_EMAILS` | Comma-separated allowlist of Google emails that can sign in. | `you@gmail.com` |
| `ADMIN_EMAILS` | Optional. Extra instance admins (backups, updates, automation). **The first user to ever sign in is always admin**, listed or not. | `partner@gmail.com` |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | OAuth credentials — see step 4 below |  |

Everything else (Plaid, SimpleFIN, Polygon, Ollama) is optional and can be added later as you connect those integrations.

> **Don't commit `.env`.** It's in `.gitignore` already. Treat the `MASTER_KEY` like a password: if it leaks, the encrypted columns in your DB can be decrypted.

### 4. Google OAuth — the part everyone gets stuck on

You need a Google Cloud project, the OAuth API enabled, and a client ID/secret pair. This takes ~5 minutes the first time.

**(a) Create a Google Cloud project** at <https://console.cloud.google.com/projectcreate>. Name it whatever (e.g., `astroledger-personal`).

**(b) Enable the APIs you need** at <https://console.cloud.google.com/apis/library>:
- **People API** — required, even though Astroledger only reads email + profile
- **Gmail API** — only if you want the Gmail receipt-sync feature. You can enable this later.

Hit "Enable" on each. The dashboard sometimes lags a minute before "Enabled" sticks.

**(c) Configure the OAuth consent screen** at <https://console.cloud.google.com/apis/credentials/consent>:
- User type: **External** (unless you're on a Google Workspace and want to scope to your org)
- App name: `Astroledger` (or whatever)
- User support email: your Gmail
- Developer contact: same
- **Scopes**: add these
  - `.../auth/userinfo.email`
  - `.../auth/userinfo.profile`
  - `openid`
  - If you want Gmail receipt sync, also add: `https://www.googleapis.com/auth/gmail.readonly`
- **Test users**: add your own Gmail and any other email from `ALLOWED_EMAILS`. (You can stay in "Testing" mode forever for personal use — no need to publish.)

**(d) Create OAuth credentials** at <https://console.cloud.google.com/apis/credentials>:
- Click **+ Create credentials → OAuth client ID**
- Application type: **Web application**
- Name: `Astroledger local` (or whatever)
- **Authorized JavaScript origins**: `http://localhost:5050` (and your public URL if you have one — e.g., `https://astroledger.example.com`)
- **Authorized redirect URIs**: `http://localhost:5050/api/auth/callback/google` (and same swap for prod)
- Click **Create**

Copy the Client ID and Client Secret into your `.env`:

```env
GOOGLE_CLIENT_ID=123456789-abc...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

> If you skip step (b) (enabling the People API), sign-in succeeds but Astroledger sees an empty profile and creates a user with a null name. Symptoms: "Sign in successful" but the page loops or the sidebar shows "U" instead of your first initial.

### 5. Initialize the database

```bash
npx prisma db push    # create the schema + generate the Prisma client
npm run db:seed       # add starter tags + categories (optional)
```

This creates `prisma/dev.db` (SQLite, encrypted at the column level). Don't move or rename it without also updating `DATABASE_URL` in `.env`.

### 6. Verify the setup

```bash
npm run setup:check
```

Walks Node version, `.env` presence, required vars, Prisma client + DB file, optional LLM/Plaid integrations. Prints a punch-list of what's good and what's missing. Fix anything marked ✗ before booting.

### 7. Boot

```bash
npm run dev
```

Open <http://localhost:5050>. Sign in with Google. The first sign-in becomes the admin.

After sign-in, head to **/settings** and **enroll a passkey** (Touch ID, Windows Hello, YubiKey, etc.). After that, you can sign in with the passkey alone — no Google round-trip needed.

### 8. Connect a bank (optional — start with CSV if you're nervous)

See the **Connecting your money** section below.

---

## Connecting your money

| Method | Cost | Coverage | Best for |
|---|---|---|---|
| **SimpleFIN Bridge** | **$1.50/mo or $15/yr** | Most US banks incl. PNC | Long-term real-bank sync |
| **Plaid Link (dev tier)** | Free up to 100 Items | Wide; needs Plaid app review for prod | Wide bank coverage during dev |
| **CSV upload** | Free | Anything that exports CSV | First-time imports, backup |
| **Amazon orders** | Free | Amazon retail | Receipt matching |
| **Gmail receipts** | Free | Any merchant that emails a receipt | Receipt enrichment |

### SimpleFIN Bridge (recommended for steady-state)

1. Sign up at <https://beta-bridge.simplefin.org/>. The first 3 months are free; after that it's $1.50/mo or $15/yr.
2. Add your banks (it walks you through OAuth or login-with-screen-scrape per bank).
3. From the SimpleFIN dashboard, generate a **Setup Token** (one-time use).
4. In Astroledger, go to **/connect → SimpleFIN tile → Paste setup token → Connect**.
5. First sync pulls up to 90 days of transactions. Subsequent syncs are incremental.

### Plaid Link (free dev tier, capped at 100 Items)

1. Sign up at <https://dashboard.plaid.com/signup>. The Sandbox + Development environments are free.
2. From the Plaid dashboard, copy your **Client ID** and **Sandbox/Development secret**.
3. Add to `.env`:
   ```env
   PLAID_CLIENT_ID=your_client_id
   PLAID_SECRET=your_dev_secret
   PLAID_ENV=development   # or 'sandbox' for fake banks
   ```
4. Restart Astroledger. The /connect page now shows the Plaid tile.
5. Click **Connect with Plaid → log in to your bank**. Sandbox creds: `user_good / pass_good`.

### CSV upload (always works)

Drop any CSV from any bank/card/PayPal/Venmo onto `/connect`. The auto-detector picks a parser based on the header row. If yours isn't recognized, you'll see a "manual mapping" UI to pick which column is date/amount/description.

### Gmail receipts

One click on `/connect → Gmail tile` — uses your existing Google login plus the `gmail.readonly` scope you added in step 4(c). 10+ per-merchant parsers + a Stripe-receipt fallback handles most merchants.

---

## Quick reference

### Common scripts

```bash
npm run dev           # Next.js dev server on :5050 (HMR)
npm run build         # Production build
npm start             # Production server on :5050
npm test              # Vitest suite (19 cases)
npm run db:studio     # Prisma Studio - inspect the DB
npm run db:seed       # Seed starter tags + categories
npm run mcp           # Run MCP server over stdio
npm run llm:up        # docker compose --profile llm up -d ollama
npm run llm:down      # Stop Ollama, free VRAM
```

### Project layout

```
src/
  app/
    (app)/          # Authenticated routes (the actual app)
    (auth)/         # Sign-in flows
    api/            # API routes + server actions
    _components/    # Shared UI atoms + page-level clients
  lib/
    prisma.ts       # Prisma client + AES-256-GCM extension
    vault.ts        # In-memory DEK holder, unlocks on login
    tags.ts         # Tag CRUD + normalizer + migrations
    tagNormalize.ts # PURE tag-clutter rules (vitest-tested)
    privacy.ts      # Privacy-mode text masking (vitest-tested)
    netWorthSnapshot.ts  # Daily snapshot + transaction-walk reconstruction
    budgetTools.ts  # 25+ MCP/LLM tools, single source of truth
    timeRange.server.ts  # Cookie-driven global range filter
prisma/
  schema.prisma     # Source of truth for the data model
mcp/
  server.ts         # MCP stdio server (see mcp/README.md)
tests/              # Vitest unit + integration + Playwright e2e suites
```

---

## Screens

| Page | What it does |
|---|---|
| **/** Dashboard | Live cash counter, 12mo trail, top categories, recent activity, 90d heatmap |
| **/cashflow** | Sankey (income → tags) on desktop, ranked-bar list on mobile, calendar + timeline views |
| **/transactions** | Filter/sort table, expandable rows, bulk operations, tag picker with the normalizer rules |
| **/budgets** | Hex traffic-light grid, bars view, per-budget detail |
| **/accounts** | Balances grouped by kind (cash/credit/investments/wallets) |
| **/subscriptions** | Detected recurring charges with cadence + next charge + confidence |
| **/goals** | Savings targets, debt payoff, spending caps |
| **/networth** | Hero figure (red when net < 0), zero-split history chart (green above / red below the $0 line), asset + liability breakdown |
| **/reports** | 24mo bars, YoY, category trend |
| **/merchants** | Per-vendor totals, count, average per charge |
| **/orders** | Receipts (Gmail + Amazon) matched to bank charges |
| **/alerts** | Insights action center: savings recommendations, spending caps, upcoming charges |
| **/chat** | Ask Spacer questions about your own financial data |
| **/connect** | Live vs one-time imports split; CSV upload, Plaid Link, SimpleFIN, Gmail sync, Amazon |
| **/settings** | Passkey enrollment, sign out, theme, view density |

Topbar exposes: search, range filter (7d / 30d / 90d / 6mo / 12mo), **privacy toggle** (text-masks all currency to `$XXX`), theme, alerts, avatar.

---

## Privacy mode

Click the `◉` icon in the top bar. Every dollar amount on screen becomes `$X,XXX` (digit-masked). Works on every page, every modal, every tooltip. Nav stays readable. Toggle off to restore — originals are stashed in `data-privacy-original` and never sent to a server. Stream / pair-program / screenshot without leaking balances.

## Local LLM (Spacer chat)

Spacer is the chat persona at **/chat**. It can call any of the 25+ tools in `src/lib/budgetTools.ts` to answer questions about your money. **It is explicitly not a financial advisor** — the system prompt scopes it to reading + summarizing your own data.

Hardware-tuned defaults for RTX 2070 SUPER (8 GB) + Ryzen 9 9900X:

| Use | Model | Quant | Speed |
|---|---|---|---|
| Default | `qwen2.5:7b-instruct` | Q4_K_M | 30–50 tok/s |
| Heavier | `qwen2.5:14b-instruct` | Q4_K_M | 15–25 tok/s |
| Max | `qwen2.5:32b-instruct` | Q3_K_M | 5–8 tok/s |

```bash
npm run llm:up    # Start Ollama (auto-pulls qwen2.5:7b if needed)
npm run llm:down  # Stop, free VRAM
```

With `AUTO_START_LLM=true`, the chat endpoint auto-starts Ollama on first request and auto-stops after idle.

Spacer also has a public-good fallback: set `OLLAMA_BASE_URL` to point at any OpenAI-compatible endpoint (a shared Ollama instance on your LAN, OpenRouter, vLLM, etc.).

## MCP server (use Astroledger from Claude Code / Claude Desktop)

Astroledger ships two ways to expose its tools to an MCP client. Pick based on where your client lives:

### Option A — HTTP bridge (recommended)

Talks to your running Astroledger over its `/api/mcp` HTTP endpoint with a bearer token. **Works from anywhere** Claude Code runs — your laptop, a remote VM, a CI runner. The bridge is a tiny stdio wrapper that proxies to one or more HTTP URLs; supply a list and it auto-picks the first one that responds, then re-probes on failure. So you can configure a fast LAN URL **and** a remote-tunnel URL, and the bridge will Just Work whether you're on the home network or on the road.

```bash
# Generate a bearer token (once, then put it in your Astroledger .env as MCP_TOKEN=…)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Register with Claude Code:

```bash
claude mcp add astroledger --scope user \
  -e "ASTROLEDGER_URL=http://10.0.0.5:5050/api/mcp,https://astroledger.example.com/api/mcp" \
  -e "ASTROLEDGER_TOKEN=<the value of MCP_TOKEN in your .env>" \
  -- node /abs/path/to/astroledger/mcp/http-bridge.mjs
```

- `ASTROLEDGER_URL` — comma-separated list, tried left-to-right. Put the fastest reachable URL first (typically LAN), public URL second.
- `ASTROLEDGER_TOKEN` — must match `MCP_TOKEN` in the Astroledger server's `.env`.
- The bridge logs its picked URL on startup (stderr).

JSON-config equivalent:

```json
{
  "mcpServers": {
    "astroledger": {
      "command": "node",
      "args": ["/abs/path/to/astroledger/mcp/http-bridge.mjs"],
      "env": {
        "ASTROLEDGER_URL": "http://10.0.0.5:5050/api/mcp,https://astroledger.example.com/api/mcp",
        "ASTROLEDGER_TOKEN": "<your MCP_TOKEN>"
      }
    }
  }
}
```

### Option B — direct stdio (same machine only)

When your Claude Code client and the Astroledger DB live on the same machine, you can skip the HTTP layer:

```bash
claude mcp add astroledger --scope user -- npx tsx /abs/path/to/astroledger/mcp/server.ts
```

This runs `mcp/server.ts` against the local DB directly. Lower latency than the HTTP bridge, but only works for same-machine setups and requires the project's `node_modules` to be installed.

### Tool catalog

34 tools at last count, including: `list_transactions`, `merchant_intel`, `transaction_intel`, `subscription_intel`, `attach_tags` (accepts names + cuids + uuids), `update_tag` (rename / recolor / reparent in one verb), `generate_expense_report`, `spend_by_category`, `monthly_summary`, `find_savings`, `pair_transfers`, `net_worth`, `add_transaction`, `ingest_order`, `pair_transactions`, and more. See `src/lib/budgetTools.ts` for the full schema. The HTTP bridge auto-discovers the tool list at startup, so new tools become available without bridge updates.

## Security

- **Full database encryption** — production startup fails closed unless the encrypted SQLite driver and database key are available; all tables, sessions, settings and financial records are protected at rest.
- **Field encryption** — connector credentials, OAuth tokens, and raw provider/order bodies receive an additional AES-256-GCM layer.
- **Receipt and backup encryption** — uploaded receipts use authenticated file envelopes; backups use a separate key and are built from memory-backed scratch space before restore verification.
- **Key separation** — database, field, and backup keys are distinct root-managed files mounted read-only into the container rather than stored in Docker metadata.
- **Auth** — Google OAuth → passkey enrollment → passkey login; `ALLOWED_EMAILS` allowlist; `Sec-Fetch-Site` CSRF gate on the chat endpoint.
- **Agent audit trail** — calls through externally reachable Spacer/MCP surfaces are recorded, including write/read classification and success state; space permission/ownership changes persist in an append-only per-space audit trail.
- **Key rotation & restore drills** — `scripts/db-encryption-admin.mjs` supports full database-key rotation (`rotate-db-key`) and non-destructive backup restore drills (`restore-verify`).
- **Upload validation** — document-vault and receipt uploads pass a magic-number whitelist; executables and unknown binaries are rejected before touching the encrypted store.

---

## Troubleshooting

### "Operations timed out" on `/settings` page load after upgrade

You upgraded from an older version with thousands of transactions and the categories→tags migration ran during the page render. **Fixed in 0.2.1** — the migration now batches via `$transaction`. Pull the patch, restart.

### "Sign in successful" but lands me back on `/auth/signin`

`ALLOWED_EMAILS` in `.env` doesn't include the Google account you signed in with. Add it (case-sensitive), restart, try again.

### Passkey enrollment fails / "invalid origin"

`WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` must match the URL your browser is hitting. If you're at `http://localhost:5050`, leave them at the defaults. If you're behind a reverse proxy at `https://astroledger.example.com`, set:

```env
WEBAUTHN_RP_ID=astroledger.example.com
WEBAUTHN_ORIGIN=https://astroledger.example.com
AUTH_URL=https://astroledger.example.com
AUTH_TRUST_HOST=true
```

Passkeys are tied to the RP ID at enrollment time — changing the RP ID invalidates existing passkeys.

### `Cannot find module 'server-only'` when running MCP

You're hitting a known bug from 0.2.0 — the MCP server tried to import a Next.js-only marker package. **Fixed in 0.2.1.** Pull and rerun.

### Prisma "no migrations" warning during `db push`

`db push` is non-migration; it just syncs the schema. That's correct for SQLite + this project. Ignore the warning. For schema migrations in production, switch to `prisma migrate`.

### `MASTER_KEY must be set in production`

You set `NODE_ENV=production` but forgot `MASTER_KEY`. Generate one with `openssl rand -hex 32`, paste into `.env`, restart. Don't reuse the dev fallback key in production — it's deterministic and offers zero security.

### "Vault is locked" errors after a server restart

The vault re-unlocks on the next sign-in or session check. If a user has an active session cookie but you just restarted, the next page request will trigger the unlock via the Auth.js `session` callback. Hit any authenticated page once.

---

## Roadmap

The generational household model is implemented end to end: private/shared/stewarded spaces, delegation and account grants, permission presets, split expenses with settlement, allowances and chores, the encrypted document vault, succession with cancellation, per-space audit history, and in-app notifications. Upcoming depth work includes succession recovery codes, notification delivery channels, per-member login-tied encryption, and deeper investment/debt/asset coverage.

## License

Astroledger is released under the **Open Community License v1.1 + Software Attribution v1** (`OCL v1.1 + SWAtt v1`). See [`LICENSE`](LICENSE) and [`LICENSE-SWAtt.md`](LICENSE-SWAtt.md), or the upstream texts at <https://github.com/OpenCommunityLicence/OpenCommunityLicence>. In short: free to use, modify, and share for non-commercial community use with attribution; commercial replication requires a separate business license.
