// Investment-aware QIF support: parse !Type:Security, !Type:Prices, and
// !Type:Invst sections; ingest securities + price history; record investment
// transactions; reconstruct lot-based holdings with cost basis + realized
// gains.
//
// Quicken QIF investment format (one record per `^`-terminated block):
//   D<date>        transaction date (M/D'YY or MM/DD/YYYY)
//   N<action>      Buy | Sell | Div | ReinvDiv | XIn | XOut | StkSplit | ...
//   Y<security>    security NAME (matches !Type:Security N-line, NOT the symbol)
//   I<price>       per-share price
//   Q<quantity>    shares
//   T<amount>      total cash amount (also U — same value, U is "amount in
//                  account currency"; we prefer T, fall back to U)
//   O<commission>  commission / fee
//   C<cleared>     cleared flag (ignored)
//   M<memo>        memo
//   P<payee>       payee (for cash/transfer actions)
//   L<account>     transfer account [in brackets] for XIn/XOut
//   $<amount>      transfer cash amount
//
// Securities are keyed by NAME because Quicken's Y-line references the name,
// and many funds have no ticker symbol in the export.

import { prisma } from './prisma';
import { createHash } from 'node:crypto';

// ── action normalization ───────────────────────────────────────────────────
export type InvAction =
  | 'buy' | 'sell' | 'div' | 'reinvest' | 'interest' | 'capgain'
  | 'split' | 'shares_in' | 'shares_out' | 'transfer_in' | 'transfer_out'
  | 'cash' | 'other';

export function normalizeInvAction(raw: string): InvAction {
  const a = raw.trim().toLowerCase();
  if (/^buy/.test(a) || a === 'cvrshrt') return 'buy';
  if (/^sell/.test(a) || a === 'shtsell') return 'sell';
  if (/^reinv/.test(a)) return 'reinvest';
  if (/^div/.test(a) || a === 'cgshort' || a === 'cglong' || a === 'cgmid') {
    return a.startsWith('div') ? 'div' : 'capgain';
  }
  if (a === 'intinc' || a === 'miscinc') return 'interest';
  if (a === 'stksplit') return 'split';
  if (a === 'shrsin' || a === 'contribx') return 'shares_in';
  if (a === 'shrsout') return 'shares_out';
  if (a === 'xin') return 'transfer_in';
  if (a === 'xout') return 'transfer_out';
  if (a === 'cash') return 'cash';
  return 'other';
}

function parseQifDate(s: string): Date | null {
  // QIF dates: "8/30'23", " 2/ 6'24", "12/31/2023", "12/31'99"
  const cleaned = s.replace(/\s+/g, '');
  let m = cleaned.match(/^(\d{1,2})\/(\d{1,2})['\/](\d{2,4})$/);
  if (!m) return null;
  let [, mo, d, y] = m;
  if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  return isNaN(+date) ? null : date;
}

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const n = parseFloat(s.replace(/[,$]/g, ''));
  return isNaN(n) ? null : n;
}

function slugName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── security catalog ────────────────────────────────────────────────────────
export type ParsedSecurity = { name: string; symbol?: string; kind?: string };

const QIF_SEC_TYPE_MAP: Record<string, string> = {
  'stock': 'stock',
  'mutual fund': 'mutual_fund',
  'etf': 'etf',
  'bond': 'bond',
  'cd': 'money_market',
  'money market': 'money_market',
  'index': 'mutual_fund',
};

function mapSecKind(qifType?: string): string | undefined {
  if (!qifType) return undefined;
  return QIF_SEC_TYPE_MAP[qifType.trim().toLowerCase()] ?? 'other';
}

// Parse !Type:Security blocks → ParsedSecurity[]. Each block:
//   N<name>  S<symbol>  T<type>  ^
export function parseSecurities(lines: string[]): ParsedSecurity[] {
  const out: ParsedSecurity[] = [];
  let mode = false;
  let cur: Record<string, string> = {};
  const flush = () => {
    if (cur.N) out.push({ name: cur.N.trim(), symbol: cur.S?.trim() || undefined, kind: mapSecKind(cur.T) });
    cur = {};
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('!')) {
      if (mode) flush();
      mode = /^!Type:\s*Security/i.test(line);
      cur = {};
      continue;
    }
    if (!mode) continue;
    if (line === '^') { flush(); continue; }
    const code = line[0];
    if (!cur[code]) cur[code] = line.slice(1);
  }
  if (mode) flush();
  return out;
}

// Parse !Type:Prices blocks. Each block is a single CSV line:
//   "<symbol-or-cusip>",<price>,"<date>"
// The first field matches either Security.symbol OR is a CUSIP. We resolve
// against securities by symbol; unknown symbols are skipped (logged in result).
export type ParsedPrice = { ref: string; price: number; date: Date };
export function parsePrices(lines: string[]): ParsedPrice[] {
  const out: ParsedPrice[] = [];
  let mode = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('!')) { mode = /^!Type:\s*Prices/i.test(line); continue; }
    if (!mode || line === '^' || !line) continue;
    // "46593LR84",99.982," 2/ 6'24"
    const m = line.match(/^"([^"]*)",\s*([\d.]+)\s*,\s*"([^"]*)"/);
    if (!m) continue;
    const [, ref, priceStr, dateStr] = m;
    const price = num(priceStr);
    const date = parseQifDate(dateStr);
    if (price == null || !date) continue;
    out.push({ ref: ref.trim(), price, date });
  }
  return out;
}

// ── investment transaction parsing ──────────────────────────────────────────
export type ParsedInvTxn = {
  date: Date;
  rawAction: string;
  action: InvAction;
  securityName?: string;
  units?: number;
  price?: number;
  amount?: number;
  commission?: number;
  splitRatio?: number;
  memo?: string;
  transferAccountRef?: string;
};

// Parse the !Type:Invst blocks for a SINGLE account (caller scopes lines to one
// account's section). Returns the ordered list of investment transactions.
export function parseInvestmentTxns(lines: string[]): ParsedInvTxn[] {
  const out: ParsedInvTxn[] = [];
  let mode = false;
  let cur: Record<string, string> = {};
  const flush = () => {
    if (cur.D && cur.N) {
      const date = parseQifDate(cur.D);
      if (date) {
        const rawAction = cur.N.trim();
        const action = normalizeInvAction(rawAction);
        const units = num(cur.Q) ?? undefined;
        const parsed: ParsedInvTxn = {
          date,
          rawAction,
          action,
          securityName: cur.Y?.trim() || undefined,
          units,
          price: num(cur.I) ?? undefined,
          amount: num(cur.T) ?? num(cur.U) ?? undefined,
          commission: num(cur.O) ?? undefined,
          memo: cur.M?.trim() || undefined,
          transferAccountRef: cur.L?.replace(/^\[|\]$/g, '').trim() || undefined,
        };
        // StkSplit: Q holds the split ratio expressed in tenths-of-a-share-per-
        // old-share (Quicken convention: 20 = 2:1). Convert to a multiplier.
        if (action === 'split' && units != null) parsed.splitRatio = units / 10;
        out.push(parsed);
      }
    }
    cur = {};
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('!')) {
      if (mode) flush();
      mode = /^!Type:\s*Invst/i.test(line);
      cur = {};
      continue;
    }
    if (!mode) continue;
    if (line === '^') { flush(); continue; }
    const code = line[0];
    if (!cur[code]) cur[code] = line.slice(1);
  }
  if (mode) flush();
  return out;
}

function invTxnHash(accountId: string, t: ParsedInvTxn): string {
  const key = [accountId, t.date.toISOString().slice(0, 10), t.rawAction, t.securityName ?? '', t.units ?? '', t.amount ?? ''].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

// ── DB ingestion ────────────────────────────────────────────────────────────

// Find-or-create a Security by symbol (preferred) or name. Idempotent.
export async function ensureSecurity(s: ParsedSecurity): Promise<string> {
  const name = s.name.trim();
  const symbol = s.symbol?.trim() || null;
  if (symbol) {
    const bySym = await prisma.security.findUnique({ where: { symbol } });
    if (bySym) return bySym.id;
  }
  const byName = await prisma.security.findUnique({ where: { name } });
  if (byName) {
    // Backfill a symbol we didn't have before.
    if (symbol && !byName.symbol) {
      await prisma.security.update({ where: { id: byName.id }, data: { symbol } }).catch(() => null);
    }
    return byName.id;
  }
  const created = await prisma.security.create({
    data: { name, symbol, kind: s.kind },
  }).catch(async () => {
    // Race / unique collision — re-resolve.
    return (await prisma.security.findUnique({ where: { name } }))
        ?? (symbol ? await prisma.security.findUnique({ where: { symbol } }) : null);
  });
  if (!created) throw new Error(`Failed to ensure security: ${name}`);
  return created.id;
}

export type InvestmentImportResult = {
  securitiesCreated: number;
  pricesInserted: number;
  pricesSkippedUnknownSec: number;
  investmentTxnsInserted: number;
  investmentTxnsSkipped: number;
  holdingsRebuilt: number;
};

// Ingest the full investment side of a parsed QIF: securities, then prices,
// then per-account investment transactions. Designed to be called from
// importQif AFTER the cash accounts + bank/ccard transactions are in place
// (so transfer pairing can find the cash legs).
export async function ingestInvestments(opts: {
  securities: ParsedSecurity[];
  prices: ParsedPrice[];
  // Investment txns already scoped + tagged with their accountId.
  perAccountTxns: Array<{ accountId: string; txns: ParsedInvTxn[] }>;
}): Promise<InvestmentImportResult> {
  const result: InvestmentImportResult = {
    securitiesCreated: 0, pricesInserted: 0, pricesSkippedUnknownSec: 0,
    investmentTxnsInserted: 0, investmentTxnsSkipped: 0, holdingsRebuilt: 0,
  };

  // 1. Securities — build a name→id and symbol→id map.
  const idByName = new Map<string, string>();
  const idBySymbol = new Map<string, string>();
  for (const s of opts.securities) {
    const before = await prisma.security.count();
    const id = await ensureSecurity(s);
    const after = await prisma.security.count();
    if (after > before) result.securitiesCreated++;
    idByName.set(slugName(s.name), id);
    if (s.symbol) idBySymbol.set(s.symbol.trim().toUpperCase(), id);
  }

  // 2. Prices — resolve ref against securities. The price-series ref usually
  // equals the security's S-line symbol, but Quicken sometimes ships a
  // slightly different ticker (case, a stray prefix letter, a 401k custom
  // symbol). Resolution order:
  //   (a) exact symbol match (uppercase)
  //   (b) fuzzy: strip a single leading lowercase letter ("gCNX" → "CNX")
  //   (c) substring against any known symbol
  // Unresolved refs are counted but skipped (their holdings fall back to
  // cost-basis valuation).
  const symbolList = [...idBySymbol.keys()];
  const resolvePriceRef = (ref: string): string | undefined => {
    const up = ref.toUpperCase();
    if (idBySymbol.has(up)) return idBySymbol.get(up);
    const stripped = up.replace(/^[A-Z]/, '');
    if (stripped !== up && idBySymbol.has(stripped)) return idBySymbol.get(stripped);
    const hit = symbolList.find(s => s === stripped || up.endsWith(s) || up.includes(s));
    return hit ? idBySymbol.get(hit) : undefined;
  };

  const priceOps: Array<ReturnType<typeof prisma.securityPrice.upsert>> = [];
  for (const p of opts.prices) {
    const secId = resolvePriceRef(p.ref);
    if (!secId) { result.pricesSkippedUnknownSec++; continue; }
    priceOps.push(prisma.securityPrice.upsert({
      where: { securityId_date: { securityId: secId, date: p.date } },
      create: { securityId: secId, date: p.date, price: p.price, source: 'qif' },
      update: { price: p.price },
    }));
  }
  // Flush price upserts in chunks of 200 to avoid one giant transaction.
  for (let i = 0; i < priceOps.length; i += 200) {
    const chunk = priceOps.slice(i, i + 200);
    await prisma.$transaction(chunk);
    result.pricesInserted += chunk.length;
  }

  // 3. Investment transactions per account.
  for (const { accountId, txns } of opts.perAccountTxns) {
    for (const t of txns) {
      const securityId = t.securityName ? idByName.get(slugName(t.securityName)) ?? null : null;
      // Auto-create a security the Y-line referenced but !Type:Security didn't
      // declare (happens for some funds).
      let resolvedSecId = securityId;
      if (!resolvedSecId && t.securityName) {
        resolvedSecId = await ensureSecurity({ name: t.securityName });
        idByName.set(slugName(t.securityName), resolvedSecId);
      }
      const hash = invTxnHash(accountId, t);
      try {
        await prisma.investmentTxn.create({
          data: {
            accountId,
            securityId: resolvedSecId,
            date: t.date,
            action: t.action,
            rawAction: t.rawAction,
            units: t.units ?? null,
            price: t.price ?? null,
            amount: t.amount ?? null,
            commission: t.commission ?? null,
            splitRatio: t.splitRatio ?? null,
            memo: t.memo ?? null,
            transferAccountRef: t.transferAccountRef ?? null,
            source: 'qif',
            hash,
          },
        });
        result.investmentTxnsInserted++;
      } catch {
        result.investmentTxnsSkipped++; // dup hash on re-import
      }
    }
  }

  // 4. Rebuild holdings for every account that received investment txns.
  for (const { accountId } of opts.perAccountTxns) {
    const n = await rebuildHoldingsForAccount(accountId);
    result.holdingsRebuilt += n;
  }

  return result;
}

// ── lot-based holdings reconstruction ───────────────────────────────────────
type Lot = { units: number; costPerUnit: number; date: Date };

// Replay all InvestmentTxn rows for an account in date order, maintaining a
// FIFO lot queue per security. Produces net units + cost basis per security,
// then upserts Holding rows. Market value = net units × latest known price.
// Returns the number of holdings written.
export async function rebuildHoldingsForAccount(accountId: string): Promise<number> {
  const txns = await prisma.investmentTxn.findMany({
    where: { accountId, securityId: { not: null } },
    orderBy: { date: 'asc' },
    include: { security: true },
  });

  // Group by security, FIFO lots.
  const lotsBySec = new Map<string, { name: string; symbol: string | null; lots: Lot[]; realized: number }>();
  const ensure = (secId: string, name: string, symbol: string | null) => {
    if (!lotsBySec.has(secId)) lotsBySec.set(secId, { name, symbol, lots: [], realized: 0 });
    return lotsBySec.get(secId)!;
  };

  for (const t of txns) {
    if (!t.securityId || !t.security) continue;
    const g = ensure(t.securityId, t.security.name, t.security.symbol);
    const units = t.units ?? 0;
    const price = t.price ?? (units ? Math.abs((t.amount ?? 0) / units) : 0);

    switch (t.action) {
      case 'buy':
      case 'reinvest':
      case 'shares_in':
      case 'transfer_in': {
        if (units > 0) {
          const cost = t.amount != null ? Math.abs(t.amount) : units * price;
          g.lots.push({ units, costPerUnit: cost / units, date: t.date });
        }
        break;
      }
      case 'sell':
      case 'shares_out':
      case 'transfer_out': {
        let toRemove = Math.abs(units);
        const proceeds = t.amount != null ? Math.abs(t.amount) : toRemove * price;
        const proceedsPerUnit = toRemove ? proceeds / toRemove : 0;
        while (toRemove > 1e-9 && g.lots.length) {
          const lot = g.lots[0];
          const take = Math.min(lot.units, toRemove);
          g.realized += take * (proceedsPerUnit - lot.costPerUnit);
          lot.units -= take;
          toRemove -= take;
          if (lot.units <= 1e-9) g.lots.shift();
        }
        break;
      }
      case 'split': {
        if (t.splitRatio && t.splitRatio > 0) {
          for (const lot of g.lots) {
            lot.units *= t.splitRatio;
            lot.costPerUnit /= t.splitRatio;
          }
        }
        break;
      }
      // div / interest / capgain / cash: no share-quantity effect on lots
      default:
        break;
    }
  }

  // Latest price per security (for market value).
  const secIds = [...lotsBySec.keys()];
  const latestPrices = new Map<string, { price: number; date: Date }>();
  for (const secId of secIds) {
    const lp = await prisma.securityPrice.findFirst({
      where: { securityId: secId },
      orderBy: { date: 'desc' },
    });
    if (lp) latestPrices.set(secId, { price: lp.price, date: lp.date });
  }

  // Wipe + rewrite this account's QIF-sourced holdings (idempotent re-import).
  await prisma.holding.deleteMany({ where: { accountId, source: 'qif' } });

  let written = 0;
  for (const [secId, g] of lotsBySec) {
    const netUnits = g.lots.reduce((s, l) => s + l.units, 0);
    if (Math.abs(netUnits) < 1e-6) continue; // fully closed position
    const costBasis = g.lots.reduce((s, l) => s + l.units * l.costPerUnit, 0);
    const lp = latestPrices.get(secId);
    const marketValue = lp ? netUnits * lp.price : null;
    const symbol = g.symbol ?? g.name.slice(0, 24);
    await prisma.holding.upsert({
      where: { accountId_symbol: { accountId, symbol } },
      create: {
        accountId, symbol, securityId: secId, description: g.name,
        units: netUnits, costBasis, marketValue,
        lastPriceAsOf: lp?.date ?? null, source: 'qif',
      },
      update: {
        securityId: secId, description: g.name, units: netUnits, costBasis,
        marketValue, lastPriceAsOf: lp?.date ?? null, source: 'qif',
      },
    });
    written++;
  }

  // Update the account's balance to the sum of holding market values (or cost
  // basis when no price is known) so net worth reflects the investment account.
  const holdings = await prisma.holding.findMany({ where: { accountId } });
  const acctValue = holdings.reduce((s, h) => s + (h.marketValue ?? h.costBasis ?? 0), 0);
  if (acctValue > 0) {
    await prisma.bankAccount.update({
      where: { id: accountId },
      data: { balance: acctValue, balanceAsOf: new Date() },
    }).catch(() => null);
  }

  return written;
}
