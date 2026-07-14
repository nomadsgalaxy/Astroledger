// Quicken-family import: OFX, QFX (Quicken Financial Exchange), QIF.
// .QDF native binary is NOT supported (would need Quicken itself); user should
// "Export to QIF/QFX" from Quicken first.

import { prisma } from './prisma';
import { normalizeMerchant } from './merchant';
import { categorize } from './categorize';
import { txnHash } from './hash';
import { reconcileAnticipated } from './anticipatedMatch';
import { extractMask, findAccountByMaskFromName } from './accountMerge';
import { pairCrossAccountTransfers } from './transferPairing';
import {
  parseSecurities, parsePrices, parseInvestmentTxns, ingestInvestments,
  type ParsedInvTxn, type InvestmentImportResult,
} from './investmentImport';

// Soft dedup: the primary hash uses rawDescription which differs across
// sources (e.g. PNC CSV says "PURCHASE AUTHORIZED ON 05/14 AMAZON RETA*..."
// while Quicken QIF says "Amazon"). Same logical transaction → two different
// hashes → duplicate. So before inserting, also check for an existing tx with
// the same (accountId, date, amount, normalizedMerchant). If found, skip.
async function alreadyImported(opts: {
  accountId: string; date: Date; amount: number; merchant: string;
}): Promise<boolean> {
  const dayStart = new Date(opts.date); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd   = new Date(opts.date); dayEnd.setUTCHours(23, 59, 59, 999);
  const existing = await prisma.transaction.findFirst({
    where: {
      accountId: opts.accountId,
      date: { gte: dayStart, lte: dayEnd },
      amount: opts.amount,
      merchant: opts.merchant,
    },
    select: { id: true },
  });
  return !!existing;
}

export type QuickenImportResult = {
  format: 'ofx' | 'qfx' | 'qif';
  inserted: number;
  skipped: number;
  accountName: string;
  tagsImported?: number;
  categoriesImported?: number;
  // Investment side (QIF only). Present when the file had !Type:Invst sections.
  investments?: InvestmentImportResult;
};

// ---------- format detection ----------
export function detectFormat(text: string): 'ofx' | 'qfx' | 'qif' | null {
  const head = text.slice(0, 4000).trim();
  if (head.startsWith('!Type:') || /\n!Type:/.test(head)) return 'qif';
  if (/OFXHEADER|<OFX>/i.test(head)) {
    // QFX is OFX with INTU.BID / INTU.USERID tags; not reliably distinguishable.
    // Treat both the same - parser handles them.
    return /INTU\.BID|INTU\.USERID/i.test(text) ? 'qfx' : 'ofx';
  }
  return null;
}

// ---------- OFX/QFX parser ----------
// SGML-style: tags often unclosed. Convert to XML-ish first, then regex out
// the bits we need (no XML parser needed - OFX subset).

function ofxFieldMap(text: string): Map<string, string[]> {
  // Normalize OFX SGML: each <TAG>value (no closing tag) → <TAG>value</TAG>.
  // Block tags like <STMTTRN>...</STMTTRN> are preserved.
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const m = line.match(/^<([A-Z0-9.]+)>(.+)$/);
    if (m && !line.startsWith('</') && !/<\//.test(line)) {
      out.push(`<${m[1]}>${m[2]}</${m[1]}>`);
    } else {
      out.push(line);
    }
  }
  const joined = out.join('\n');
  // Build a multi-map of all tag occurrences (we don't preserve hierarchy
  // because OFX transactions are flat enough that we just regex-extract per block).
  const map = new Map<string, string[]>();
  joined.replace(/<([A-Z0-9.]+)>([^<]+)<\/\1>/g, (_, tag, val) => {
    const arr = map.get(tag) ?? [];
    arr.push(val.trim());
    map.set(tag, arr);
    return '';
  });
  return map;
}

function parseOfxDate(s: string): Date | null {
  // YYYYMMDD or YYYYMMDDHHMMSS[.XXX][TZ]
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, hh = '0', mm = '0', ss = '0'] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss));
}

async function importOfx(text: string, fallbackAccountName: string): Promise<QuickenImportResult> {
  // Per-statement-block parsing. Extract <STMTTRN>...</STMTTRN> blocks; also
  // <BANKACCTFROM>/<CCACCTFROM> for account id.
  const acctMatch = text.match(/<(BANKACCTFROM|CCACCTFROM)>([\s\S]*?)<\/\1>/);
  const acctBlock = acctMatch ? acctMatch[2] : '';
  const acctId   = (acctBlock.match(/<ACCTID>([^<\n]+)/) ?? [, ''])[1].trim();
  const orgMatch = text.match(/<ORG>([^<\n]+)/);
  const institutionName = orgMatch?.[1]?.trim() || 'OFX Import';
  const accountName = acctId ? `${institutionName} ${acctId.slice(-4)}` : fallbackAccountName;

  // Find/create institution + account
  let institution = await prisma.institution.findFirst({ where: { name: institutionName, source: 'ofx' } });
  if (!institution) institution = await prisma.institution.create({ data: { name: institutionName, source: 'ofx' } });

  let account = await prisma.bankAccount.findFirst({ where: { institutionId: institution.id, name: accountName } });
  if (!account) account = await prisma.bankAccount.create({
    data: { institutionId: institution.id, name: accountName, type: acctMatch?.[1] === 'CCACCTFROM' ? 'credit' : 'depository', mask: acctId.slice(-4) || null },
  });

  const categories = await prisma.category.findMany();
  const catByName = new Map(categories.map(c => [c.name, c.id]));

  let inserted = 0, skipped = 0;
  const blocks = [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/g)];
  for (const [, block] of blocks) {
    const f = ofxFieldMap(`<STMTTRN>${block}</STMTTRN>`);
    const dtposted = f.get('DTPOSTED')?.[0];
    const trnamt   = f.get('TRNAMT')?.[0];
    const name     = f.get('NAME')?.[0] ?? f.get('PAYEE')?.[0];
    const memo     = f.get('MEMO')?.[0];
    const fitid    = f.get('FITID')?.[0];
    if (!dtposted || !trnamt) { skipped++; continue; }
    const date = parseOfxDate(dtposted);
    const amount = parseFloat(trnamt);
    if (!date || isNaN(amount)) { skipped++; continue; }
    const desc = (name || memo || '').trim();
    if (!desc) { skipped++; continue; }
    const merchant = normalizeMerchant(desc);
    if (await alreadyImported({ accountId: account.id, date, amount, merchant })) {
      skipped++; continue;
    }
    const categoryName = categorize(merchant, desc, amount);
    const categoryId = catByName.get(categoryName) ?? catByName.get('Other');
    const hash = txnHash({ accountId: account.id, date, amount, rawDescription: desc });
    try {
      await prisma.transaction.create({
        data: {
          accountId: account.id,
          plaidTxId: fitid ? `ofx:${fitid}` : undefined,
          hash, date, amount, rawDescription: desc,
          merchant, categoryId,
          isTransfer: categoryName === 'Transfers',
        },
      });
      inserted++;
    } catch { skipped++; }
  }

  // Reconcile any anticipated transactions in this account against the new
  // bank rows. Best-effort: errors are swallowed so a flaky LLM doesn't fail
  // the import.
  if (inserted > 0) {
    await reconcileAnticipated(account.id).catch(() => null);
    // Detect cross-account transfers + CC payments so the newly-imported rows
    // don't double-count in income/spending totals.
    await pairCrossAccountTransfers({ rangeDays: 3 }).catch(() => null);
  }

  return { format: 'ofx', inserted, skipped, accountName };
}

// ---------- QIF parser ----------
// Quicken's "Export all accounts" produces multi-account QIF:
//   !Account            <- account-header section
//   NMy Bank Checking   <- account name
//   TBank               <- account type
//   ^
//   !Type:Bank          <- begin transactions for the account just declared
//   D03/01/2024
//   T-50.00
//   PSomeMerchant
//   ^
//   ...
//   !Account            <- next account
//   NCredit Card
//   TCCard
//   ^
//   !Type:CCard
//   ...
// We honor !Account blocks: each becomes its own Astroledger BankAccount (or
// merges into an existing one by name match). If no !Account directive is
// present, we fall back to a single account named `fallbackAccountName`.
// Parse a QIF L (category) line for transfer-bracket notation. Quicken writes
// transfers as `[Account Name]`, optionally with a class suffix
// `[Account Name]/ClassName`. Returns the bracketed account name, or null when
// the L line is an ordinary spending category. The leading 'L' is already
// stripped by the time we read `cur.L`.
function parseQifTransferRef(lRaw: string | undefined): string | null {
  if (!lRaw) return null;
  const m = lRaw.match(/^\[([^\]]+)\]/);
  return m ? m[1].trim() : null;
}

// Bare category name with any class suffix stripped (no transfer handling).
function categoryName0(lRaw: string | undefined): string {
  if (!lRaw) return '';
  return lRaw.split('/')[0].trim();
}

type QifAcctType = 'Bank' | 'CCard' | 'Cash' | 'Invst' | 'Oth A' | 'Oth L' | string;
function mapQifType(t: QifAcctType): 'depository' | 'credit' | 'investment' | 'loan' | 'other' {
  const s = (t || '').trim();
  if (/^bank$/i.test(s) || /^cash$/i.test(s)) return 'depository';
  if (/^ccard$/i.test(s)) return 'credit';
  // Investment-family account types Quicken emits in !Account T-lines:
  //   Invst, 401(k)/403(b), Mutual Fund, Port (portfolio).
  if (/^invst$/i.test(s) || /401\(k\)|403\(b\)|mutual\s*fund|^port$/i.test(s)) return 'investment';
  if (/^oth\s*l$/i.test(s)) return 'loan';  // "Oth L" = other liability (loans)
  return 'other';
}

async function importQif(text: string, fallbackAccountName: string): Promise<QuickenImportResult> {
  let institution = await prisma.institution.findFirst({ where: { name: 'QIF Import', source: 'qif' } });
  if (!institution) institution = await prisma.institution.create({ data: { name: 'QIF Import', source: 'qif' } });

  // Find-or-create an account. Priority order:
  //   1. exact-name match across institutions (re-import idempotency)
  //   2. mask-match (last-4 digits): "Fidelity ROTH IRA XX1625" → existing
  //      account with mask=1625, even if names differ
  //   3. fall back to creating a new account under the QIF Import institution.
  // The extracted mask is also stored on freshly-created accounts so future
  // imports can find them via mask.
  async function ensureAccount(name: string, type: ReturnType<typeof mapQifType>) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const byName = await prisma.bankAccount.findFirst({ where: { name: trimmed } });
    if (byName) return byName;
    const byMask = await findAccountByMaskFromName(trimmed);
    if (byMask) return byMask;
    const parsedMask = extractMask(trimmed);
    return prisma.bankAccount.create({
      data: {
        institutionId: institution!.id,
        name: trimmed,
        type,
        mask: parsedMask,
      },
    });
  }

  const categories = await prisma.category.findMany();
  const catByName = new Map(categories.map(c => [c.name, c.id]));

  // State machine. Quicken QIF has several non-transaction sections we must
  // recognize (!Type:Tag, !Type:Cat, !Type:Class, !Type:Memorized, !Type:Security,
  // !Type:Prices, !Type:Invst) so we don't mistake their fields for transactions.
  // Transaction sections we DO want: Bank, CCard, Cash, Oth A, Oth L.
  const lines = text.split(/\r?\n/);
  let inserted = 0, skipped = 0, tagsImported = 0, catsImported = 0;
  let mode: 'tx' | 'account' | 'tag' | 'cat' | 'invst' | 'skip' | null = null;
  let cur: Record<string, string> = {};
  let currentAccount: { id: string; name: string } | null = null;
  let pendingAccount: { name?: string; type?: QifAcctType } = {};
  const TX_SECTIONS = /^!Type:\s*(Bank|CCard|Cash|Oth\s*A|Oth\s*L)\s*$/i;

  // Investment sections (!Type:Invst) are buffered per-account so we can run
  // the lot-based reconstruction after all cash accounts exist (transfer
  // pairing needs the cash legs in place). Each buffer includes a synthetic
  // header line so parseInvestmentTxns enters its parsing mode.
  const invstBuffers: Array<{ accountId: string; accountName: string; lines: string[] }> = [];
  let currentInvstBuffer: string[] | null = null;

  const fallbackAccount = await ensureAccount(fallbackAccountName || 'QIF Import', 'depository');

  const flushTx = async () => {
    if (Object.keys(cur).length === 0) return;
    if (!currentAccount) currentAccount = fallbackAccount ? { id: fallbackAccount.id, name: fallbackAccount.name } : null;
    if (!currentAccount) { cur = {}; return; }
    const dateStr = cur.D;
    const amtStr  = cur.T || cur.U;
    const payee   = cur.P;
    const memo    = cur.M;
    const qifCat  = cur.L;
    if (!dateStr || !amtStr) { skipped++; cur = {}; return; }
    const m = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-'](\d{2,4})/);
    if (!m) { skipped++; cur = {}; return; }
    let [, mo, d, y] = m;
    if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
    const date = new Date(Date.UTC(+y, +mo - 1, +d));
    const amount = parseFloat(amtStr.replace(/[,$]/g, ''));
    if (isNaN(amount)) { skipped++; cur = {}; return; }
    const desc = (payee || memo || qifCat || '').trim();
    if (!desc) { skipped++; cur = {}; return; }
    const merchant = normalizeMerchant(desc);
    if (await alreadyImported({ accountId: currentAccount.id, date, amount, merchant })) {
      skipped++; cur = {}; return;
    }

    // Quicken transfer detection. The L (category) line uses bracket notation
    // for transfers: `L[Other Account Name]` (optionally with a class suffix
    // `L[Account]/ClassName`). This is a DETERMINISTIC transfer marker — both
    // legs of the move carry it — so we honor it at import time rather than
    // relying on the fuzzy post-import amount-matcher (which missed e.g. the
    // credit-card payments to "Dad - Chase Visa 4159", landing them as
    // positive non-transfer inflows that inflated income). See task #220.
    const xferRef = parseQifTransferRef(qifCat);
    const isXfer = !!xferRef || categoryName0(qifCat) === 'Transfers';
    // Deterministic group id keyed on the unordered account pair + date +
    // abs(amount), so the two legs (this account ↔ xferRef account) compute
    // the SAME id independently and pair without guessing. Falls back to a
    // self-keyed id when the counter-account name is absent.
    let transferGroupId: string | undefined;
    if (xferRef) {
      const pair = [currentAccount.name, xferRef].sort().join('|');
      transferGroupId = 'qif:' + txnHash({
        accountId: pair, date, amount: Math.abs(amount), rawDescription: 'xfer',
      });
    }

    // When L is a bracketed transfer, it is NOT a spending category — don't
    // let it pollute categorization.
    const categoryName = (!xferRef && qifCat && catByName.has(qifCat))
      ? qifCat
      : (isXfer ? 'Transfers' : categorize(merchant, desc, amount));
    const categoryId = catByName.get(categoryName) ?? catByName.get('Other');
    const hash = txnHash({ accountId: currentAccount.id, date, amount, rawDescription: desc });
    try {
      await prisma.transaction.create({
        data: {
          accountId: currentAccount.id, hash, date, amount,
          rawDescription: desc, merchant, categoryId,
          // Preserve the original bracketed transfer target in notes for audit;
          // keep the Quicken-category note for genuinely-unmapped categories.
          notes: xferRef
            ? `Quicken transfer: [${xferRef}]`
            : (qifCat && !catByName.has(qifCat) ? `Quicken category: ${qifCat}` : undefined),
          isTransfer: isXfer,
          transferGroupId,
        },
      });
      inserted++;
    } catch { skipped++; }
    cur = {};
  };

  const flushAccount = async () => {
    if (pendingAccount.name) {
      const acct = await ensureAccount(pendingAccount.name, mapQifType(pendingAccount.type || 'Bank'));
      if (acct) currentAccount = { id: acct.id, name: acct.name };
    }
    pendingAccount = {};
  };

  // Helpers for Tag/Cat blocks - best-effort import so the user keeps their
  // existing labels. Anything we can't map cleanly is silently skipped.
  const flushTag = async () => {
    const name = cur.N?.trim();
    if (!name) { cur = {}; return; }
    const exists = await prisma.tag.findFirst({ where: { name } });
    if (!exists) {
      try {
        await prisma.tag.create({ data: { name, kind: 'primary' } });
        tagsImported++;
      } catch { /* unique collision - ignore */ }
    }
    cur = {};
  };
  const flushCat = async () => {
    const name = cur.N?.trim();
    if (!name) { cur = {}; return; }
    // QIF "N" for sub-categories uses colon syntax: "Auto:Fuel". Keep the leaf
    // name only - Astroledger's Category model is flat with optional parent later.
    const leaf = name.split(':').pop()!.trim();
    const exists = await prisma.category.findFirst({ where: { name: leaf } });
    if (!exists) {
      try {
        await prisma.category.create({ data: { name: leaf } });
        catsImported++;
      } catch { /* unique collision - ignore */ }
    }
    cur = {};
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('!')) {
      // Section header - flush whatever was in flight first
      if (mode === 'tx') await flushTx();
      else if (mode === 'account') await flushAccount();
      else if (mode === 'tag') await flushTag();
      else if (mode === 'cat') await flushCat();
      cur = {};

      if (/^!Account/i.test(line)) {
        mode = 'account';
        pendingAccount = {};
      } else if (/^!Type:\s*Tag/i.test(line)) {
        mode = 'tag';
      } else if (/^!Type:\s*Cat/i.test(line)) {
        mode = 'cat';
      } else if (TX_SECTIONS.test(line)) {
        mode = 'tx';
      } else if (/^!Type:\s*Invst/i.test(line)) {
        // Investment section for the account most recently declared. Buffer
        // its raw lines (incl. a synthetic header) for post-pass ingestion.
        mode = 'invst';
        // `currentAccount` is only ever reassigned inside the flush closures,
        // which TS's control-flow analysis can't see — so at this point it
        // wrongly narrows the value to `null` (and `never` inside the if). The
        // assertion restores the real declared type so the field accesses below
        // compile. At runtime currentAccount is set by flushAccount before any
        // !Type:Invst section, since Quicken always emits !Account first.
        const invstAcct = currentAccount as { id: string; name: string } | null;
        if (invstAcct) {
          currentInvstBuffer = ['!Type:Invst'];
          invstBuffers.push({
            accountId: invstAcct.id,
            accountName: invstAcct.name,
            lines: currentInvstBuffer,
          });
        } else {
          currentInvstBuffer = null;
        }
      } else {
        // !Type:Class, !Type:Memorized, !Type:Security, !Type:Prices,
        // !Option, etc. (Security + Prices are parsed globally below.)
        mode = 'skip';
      }
      continue;
    }
    if (line === '^') {
      if (mode === 'tx')      await flushTx();
      else if (mode === 'account') await flushAccount();
      else if (mode === 'tag')     await flushTag();
      else if (mode === 'cat')     await flushCat();
      else if (mode === 'invst' && currentInvstBuffer) currentInvstBuffer.push('^');
      else                          cur = {};
      continue;
    }
    const code = line[0];
    const val = line.slice(1);
    if (mode === 'account') {
      if (code === 'N') pendingAccount.name = val;
      else if (code === 'T') pendingAccount.type = val as QifAcctType;
    } else if (mode === 'tx' || mode === 'tag' || mode === 'cat') {
      if (!cur[code]) cur[code] = val; // first occurrence wins; ignore split lines (S) for MVP
    } else if (mode === 'invst' && currentInvstBuffer) {
      currentInvstBuffer.push(line); // raw line; parseInvestmentTxns handles it
    }
    // mode === 'skip' or null → ignore body lines entirely
  }
  if (mode === 'tx')      await flushTx();
  else if (mode === 'account') await flushAccount();
  else if (mode === 'tag')     await flushTag();
  else if (mode === 'cat')     await flushCat();

  // ── Investment side ───────────────────────────────────────────────────
  // Parse !Type:Security + !Type:Prices once over the whole file, then the
  // per-account !Type:Invst buffers we collected, and ingest. Securities +
  // prices feed lot-based holdings reconstruction (see investmentImport.ts).
  let investments: InvestmentImportResult | undefined;
  if (invstBuffers.length > 0) {
    const securities = parseSecurities(lines);
    const prices = parsePrices(lines);
    const perAccountTxns = invstBuffers.map(b => ({
      accountId: b.accountId,
      txns: parseInvestmentTxns(b.lines) as ParsedInvTxn[],
    })).filter(p => p.txns.length > 0);
    investments = await ingestInvestments({ securities, prices, perAccountTxns });
  }

  // Reconcile anticipated txns against every account that received imports.
  // We don't have a tidy list of all accounts touched, so reconcile against
  // every account known to the system that has at least one anticipated row.
  if (inserted > 0) {
    const accountsWithAnticipated = await prisma.transaction.findMany({
      where: { isAnticipated: true },
      select: { accountId: true },
      distinct: ['accountId'],
    });
    for (const { accountId } of accountsWithAnticipated) {
      await reconcileAnticipated(accountId).catch(() => null);
    }
    // Detect cross-account transfers + CC payments now that all the QIF
    // accounts and their transactions are in the DB.
    await pairCrossAccountTransfers({ rangeDays: 3 }).catch(() => null);
  }

  const finalAccount = currentAccount as { id: string; name: string } | null;
  return {
    format: 'qif', inserted, skipped,
    accountName: finalAccount?.name || fallbackAccountName,
    tagsImported, categoriesImported: catsImported,
    investments,
  };
}

// ---------- top-level dispatch ----------
export async function importQuicken(text: string, fallbackAccountName: string): Promise<QuickenImportResult> {
  const fmt = detectFormat(text);
  if (!fmt) throw new Error('Could not detect file format. Supported: OFX, QFX, QIF.');
  if (fmt === 'qif') return importQif(text, fallbackAccountName);
  return importOfx(text, fallbackAccountName);
}
