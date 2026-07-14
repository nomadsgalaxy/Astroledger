// SimpleFIN Bridge connector - https://beta-bridge.simplefin.org/info/developers
//
// Flow:
//   1. User signs up at beta-bridge.simplefin.org and connects their banks.
//   2. SimpleFIN gives them a one-time-use Setup Token (base64'd URL).
//   3. We POST that to the claim URL to exchange for a long-lived Access URL
//      (format: https://username:password@host/path). Store encrypted.
//   4. Periodically GET {access_url}/accounts → JSON with accounts + transactions.

import { prisma } from './prisma';
import { normalizeMerchant } from './merchant';
import { categorize } from './categorize';
import { txnHash } from './hash';
import { extractMask } from './accountMerge';

type SfHolding = {
  id?: string;
  symbol?: string;
  description?: string;
  shares?: string;
  market_value?: string;
  cost_basis?: string;
  currency?: string;
  'price-date'?: number;
};

type SfAccount = {
  org: { domain?: string; name?: string; url?: string; id?: string };
  id: string;
  name: string;
  currency: string;
  balance: string;
  'available-balance'?: string;
  'balance-date': number;
  transactions?: SfTransaction[];
  holdings?: SfHolding[];
};

type SfTransaction = {
  id: string;
  posted: number;
  amount: string;
  description: string;
  payee?: string;
  memo?: string;
  pending?: boolean;
};

type SfResponse = { errors?: string[]; accounts: SfAccount[] };

export class SimpleFinClaimError extends Error {
  status: number;
  reason: 'invalid_token' | 'already_claimed' | 'forbidden' | 'network' | 'unknown';
  constructor(message: string, status: number, reason: SimpleFinClaimError['reason']) {
    super(message); this.name = 'SimpleFinClaimError';
    this.status = status; this.reason = reason;
  }
}

// Claim a setup token → access URL. Setup token is base64-encoded URL the user pastes.
export async function claimSetupToken(setupToken: string): Promise<string> {
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(setupToken.trim(), 'base64').toString('utf8').trim();
  } catch {
    throw new SimpleFinClaimError('Setup token is not valid base64', 400, 'invalid_token');
  }
  if (!/^https:\/\//.test(claimUrl)) {
    throw new SimpleFinClaimError(
      `Decoded setup token is not a URL (starts with "${claimUrl.slice(0, 30)}..."). Make sure you copied the full token from beta-bridge.simplefin.org.`,
      400, 'invalid_token',
    );
  }

  let res: Response;
  try {
    res = await fetch(claimUrl, { method: 'POST' });
  } catch (e: any) {
    throw new SimpleFinClaimError(`Could not reach SimpleFIN bridge: ${e?.message ?? e}`, 502, 'network');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // SimpleFIN returns 403 for already-claimed and invalid tokens. The body
    // sometimes contains "Already Claimed" or similar; surface that verbatim.
    const looksClaimed = /already.?claim/i.test(body) || res.status === 403;
    const reason: SimpleFinClaimError['reason'] = looksClaimed ? 'already_claimed' : 'forbidden';
    const hint = looksClaimed
      ? 'Setup tokens are one-time use. Click "New Setup Token" at beta-bridge.simplefin.org and paste the fresh one.'
      : 'SimpleFIN bridge rejected the token.';
    throw new SimpleFinClaimError(`${hint} (bridge said: HTTP ${res.status}${body ? ` - ${body.slice(0, 200)}` : ''})`, res.status, reason);
  }
  const accessUrl = (await res.text()).trim();
  if (!/^https:\/\/.+:.+@/.test(accessUrl)) {
    throw new SimpleFinClaimError('SimpleFIN returned an unexpected response (no credentials in claimed URL).', 502, 'unknown');
  }
  return accessUrl;
}

// Sync all SimpleFIN-sourced institutions (or one by id). Idempotent.
// Returns disconnected[] so the UI can surface "this institution lost its
// access token and needs reconnecting" instead of silently skipping.
export type SimpleFinSyncResult = {
  synced: number;
  added: number;
  updated: number;
  accounts: number;
  disconnected: Array<{ institutionId: string; institutionName: string; reason: string }>;
};

export async function syncSimpleFin(opts: { institutionId?: string; sinceDays?: number } = {}): Promise<SimpleFinSyncResult> {
  const where: { source: 'simplefin'; id?: string } = { source: 'simplefin' };
  if (opts.institutionId) where.id = opts.institutionId;
  const insts = await prisma.institution.findMany({ where });
  if (insts.length === 0) return { synced: 0, added: 0, updated: 0, accounts: 0, disconnected: [] };

  // SimpleFIN itself retains ≤ 365 days of history per the bridge spec.
  // Default to a full year so refreshes meaningfully backfill.
  const startDate = opts.sinceDays
    ? Math.floor((Date.now() - opts.sinceDays * 86400000) / 1000)
    : Math.floor((Date.now() - 365 * 86400000) / 1000);

  const categories = await prisma.category.findMany();
  const catByName = new Map(categories.map(c => [c.name, c.id]));

  let totalAdded = 0, totalUpdated = 0, totalAccounts = 0;
  const disconnected: SimpleFinSyncResult['disconnected'] = [];

  for (const inst of insts) {
    if (!inst.accessToken) {
      disconnected.push({ institutionId: inst.id, institutionName: inst.name, reason: 'No access token stored (never connected or token cleared)' });
      continue;
    }
    // Modern fetch rejects URLs with inline credentials. Extract them and use Basic auth header.
    const url = new URL(inst.accessToken);
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    url.username = '';
    url.password = '';
    url.pathname = url.pathname.replace(/\/$/, '') + '/accounts';
    url.searchParams.set('start-date', String(startDate));
    url.searchParams.set('pending', '1');

    const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    const res = await fetch(url.toString(), { headers: { Authorization: authHeader } });
    if (res.status === 401 || res.status === 403) {
      disconnected.push({ institutionId: inst.id, institutionName: inst.name, reason: `Bridge rejected credentials (HTTP ${res.status}) - setup token may have been revoked` });
      continue;
    }
    if (!res.ok) throw new Error(`SimpleFIN sync ${inst.name} failed ${res.status}: ${await res.text()}`);
    const data = await res.json() as SfResponse;
    if (data.errors?.length) console.warn(`[simplefin] ${inst.name}:`, data.errors);

    for (const sfAcc of data.accounts ?? []) {
      totalAccounts++;
      // Account upsert
      const externalAcctId = `simplefin:${sfAcc.id}`;
      const parsedMask = extractMask(sfAcc.name);
      const acct = await prisma.bankAccount.upsert({
        where: { plaidAccountId: externalAcctId },
        update: {
          name: sfAcc.name,
          balance: parseFloat(sfAcc.balance) || 0,
          currency: sfAcc.currency || 'USD',
          ...(parsedMask ? { mask: parsedMask } : {}),
        },
        create: {
          institutionId: inst.id,
          plaidAccountId: externalAcctId,
          name: sfAcc.name,
          type: 'depository',
          currency: sfAcc.currency || 'USD',
          balance: parseFloat(sfAcc.balance) || 0,
          mask: parsedMask,
        },
      });

      // Upsert holdings if the account has any (investment accounts).
      if (Array.isArray(sfAcc.holdings)) {
        for (const h of sfAcc.holdings) {
          const symbol = (h.symbol ?? h.id ?? '').trim();
          if (!symbol) continue;
          const data = {
            description: h.description ?? null,
            units: parseFloat(h.shares ?? '0') || 0,
            marketValue: h.market_value != null ? parseFloat(h.market_value) : null,
            costBasis: h.cost_basis != null ? parseFloat(h.cost_basis) : null,
            currency: h.currency ?? sfAcc.currency ?? 'USD',
            lastPriceAsOf: h['price-date'] ? new Date(h['price-date'] * 1000) : null,
            source: 'simplefin',
          };
          await prisma.holding.upsert({
            where: { accountId_symbol: { accountId: acct.id, symbol } },
            update: data,
            create: { accountId: acct.id, symbol, ...data },
          }).catch(() => null);
        }
      }

      for (const tx of sfAcc.transactions ?? []) {
        const amount = parseFloat(tx.amount); // SimpleFIN: negative = outflow (matches our convention)
        const date = new Date(tx.posted * 1000);
        const desc = tx.description || tx.payee || tx.memo || '';
        const merchant = tx.payee ? normalizeMerchant(tx.payee) : normalizeMerchant(desc);
        const categoryName = categorize(merchant, desc, amount);
        const categoryId = catByName.get(categoryName) ?? catByName.get('Other');
        const externalTxId = `simplefin:${tx.id}`;
        const hash = txnHash({ accountId: acct.id, date, amount, rawDescription: desc });

        try {
          await prisma.transaction.create({
            data: {
              accountId: acct.id,
              plaidTxId: externalTxId,
              hash, date, amount,
              rawDescription: desc,
              merchant, categoryId,
              pending: !!tx.pending,
              isTransfer: categoryName === 'Transfers',
            },
          });
          totalAdded++;
        } catch {
          // Dup (either FITID or hash collision) - update non-key fields.
          await prisma.transaction.updateMany({
            where: { plaidTxId: externalTxId },
            data: { amount, rawDescription: desc, pending: !!tx.pending },
          });
          totalUpdated++;
        }
      }
    }
  }

  // Detect cross-account transfers + CC payments so newly-imported rows don't
  // double-count in income/spending totals. Also runs the rules engine and
  // captures a net-worth snapshot in one shared post-import step.
  if (totalAdded > 0) {
    const { postImport } = await import('./postImport');
    await postImport();
  }

  return { synced: insts.length, added: totalAdded, updated: totalUpdated, accounts: totalAccounts, disconnected };
}

// Convenience: claim token, store institution, do initial sync. If
// `reconnectInstitutionId` is supplied, the existing institution row gets the
// new access URL instead of creating a duplicate row - this is the path the
// "Reconnect" button on /connect uses when SimpleFIN dropped the token.
export async function connectSimpleFin(setupToken: string, displayName?: string, reconnectInstitutionId?: string) {
  const accessUrl = await claimSetupToken(setupToken);
  const url = new URL(accessUrl);
  const orgHost = url.hostname;

  let instId: string;
  if (reconnectInstitutionId) {
    const existing = await prisma.institution.findUnique({ where: { id: reconnectInstitutionId } });
    if (!existing) throw new Error(`Institution ${reconnectInstitutionId} not found`);
    if (existing.source !== 'simplefin') throw new Error(`Institution is not a SimpleFIN connection`);
    await prisma.institution.update({
      where: { id: reconnectInstitutionId },
      data: {
        accessToken: accessUrl,
        ...(displayName ? { name: displayName } : {}),
      },
    });
    instId = reconnectInstitutionId;
  } else {
    const inst = await prisma.institution.create({
      data: {
        name: displayName || `SimpleFIN (${orgHost})`,
        source: 'simplefin',
        accessToken: accessUrl,
      },
    });
    instId = inst.id;
  }
  const sync = await syncSimpleFin({ institutionId: instId });
  return { institutionId: instId, ...sync };
}
