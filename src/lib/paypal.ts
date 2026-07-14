// PayPal connector - REST Transaction Reporting API.
//
// Auth: OAuth2 client credentials. Token cached in-memory until expiry.
// Endpoint: GET /v1/reporting/transactions  (max 31-day window per call)
// Scope:    https://uri.paypal.com/services/reporting/search/read
//
// IMPORTANT: This API is restricted to PayPal BUSINESS accounts with
// "Transaction Search" enabled on the app. Personal accounts get 403 from
// PayPal. For Personal users, fall back to the CSV importer (PayPal.com →
// Activity → Download).

import { prisma } from './prisma';
import { normalizeMerchant } from './merchant';
import { categorize } from './categorize';
import { txnHash } from './hash';

type PayPalCreds = { clientId: string; secret: string; env: 'live' | 'sandbox' };

const BASE = (env: 'live' | 'sandbox') =>
  env === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

// ---------- credential storage (encrypted via Institution.accessToken) ----------

export async function savePayPalCreds(displayName: string, creds: PayPalCreds): Promise<string> {
  // Validate by minting a token first - catches bad creds before we persist.
  await getAccessToken(creds);
  const existing = await prisma.institution.findFirst({ where: { source: 'paypal', name: displayName } });
  const payload = JSON.stringify(creds);
  if (existing) {
    await prisma.institution.update({ where: { id: existing.id }, data: { accessToken: payload } });
    return existing.id;
  }
  const created = await prisma.institution.create({
    data: { name: displayName, source: 'paypal', accessToken: payload },
  });
  return created.id;
}

async function loadCreds(institutionId: string): Promise<PayPalCreds> {
  const inst = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!inst?.accessToken) throw new Error('PayPal institution missing credentials');
  const creds = JSON.parse(inst.accessToken) as PayPalCreds;
  if (!creds.clientId || !creds.secret) throw new Error('PayPal credentials are incomplete');
  return creds;
}

// ---------- token cache ----------

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

async function getAccessToken(creds: PayPalCreds): Promise<string> {
  const cacheKey = `${creds.env}:${creds.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const basic = Buffer.from(`${creds.clientId}:${creds.secret}`).toString('base64');
  const res = await fetch(`${BASE(creds.env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed ${res.status}: ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

// ---------- types ----------

type PpTransaction = {
  transaction_info?: {
    transaction_id?: string;
    transaction_initiation_date?: string;
    transaction_updated_date?: string;
    transaction_amount?: { currency_code: string; value: string };
    fee_amount?: { currency_code: string; value: string };
    transaction_status?: string;     // S=success, P=pending, V=reversed, D=denied
    transaction_subject?: string;
    transaction_note?: string;
    invoice_id?: string;
    paypal_reference_id?: string;
  };
  payer_info?: {
    account_id?: string;
    email_address?: string;
    payer_name?: { alternate_full_name?: string; given_name?: string; surname?: string };
  };
  cart_info?: { item_details?: Array<{ item_name?: string; item_quantity?: string; item_unit_price?: { value?: string } }> };
};

type PpResponse = {
  transaction_details?: PpTransaction[];
  page?: number;
  total_pages?: number;
  total_items?: number;
};

// ---------- sync ----------

function isoUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '-0000');
}

export async function syncPayPal(opts: { institutionId: string; sinceDays?: number }): Promise<{
  added: number; updated: number; windows: number;
}> {
  // PayPal Reporting API supports up to 3 years (1095d) - see start_date docs.
  // Default to 365d so a refresh actually backfills meaningfully.
  const sinceDays = opts.sinceDays ?? 365;
  const creds = await loadCreds(opts.institutionId);
  const token = await getAccessToken(creds);

  // Ensure a wallet-style "PayPal" account row exists under this institution.
  // The PayPal API doesn't expose distinct account IDs for personal-style users,
  // so we use one logical account per institution and let merchant info live on txs.
  let acct = await prisma.bankAccount.findFirst({
    where: { institutionId: opts.institutionId, type: 'wallet' },
  });
  if (!acct) {
    acct = await prisma.bankAccount.create({
      data: { institutionId: opts.institutionId, name: 'PayPal Wallet', type: 'wallet', currency: 'USD' },
    });
  }

  const categories = await prisma.category.findMany();
  const catByName = new Map(categories.map(c => [c.name, c.id]));

  const now = new Date();
  const start = new Date(+now - sinceDays * 86400000);
  let added = 0, updated = 0, windows = 0;

  // Walk 31-day windows from oldest → newest (API max)
  for (let winStart = start; winStart < now; ) {
    windows++;
    const winEnd = new Date(Math.min(+winStart + 31 * 86400000 - 1000, +now));
    let page = 1;
    while (true) {
      const url = new URL(`${BASE(creds.env)}/v1/reporting/transactions`);
      url.searchParams.set('start_date', isoUtc(winStart));
      url.searchParams.set('end_date',   isoUtc(winEnd));
      url.searchParams.set('fields',     'all');
      url.searchParams.set('page_size',  '500');
      url.searchParams.set('page',       String(page));
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.text();
        // Personal accounts get 403 here.
        if (res.status === 403) {
          throw new Error('PayPal API returned 403 - this typically means the account is Personal (not Business) or the app lacks Transaction Search scope. Use the CSV importer instead.');
        }
        throw new Error(`PayPal sync failed ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json() as PpResponse;
      const txs = data.transaction_details ?? [];
      for (const t of txs) {
        const info = t.transaction_info ?? {};
        const id = info.transaction_id;
        const dateStr = info.transaction_initiation_date ?? info.transaction_updated_date;
        const amt = info.transaction_amount?.value;
        if (!id || !dateStr || !amt) continue;
        const date = new Date(dateStr);
        const amount = parseFloat(amt); // PayPal: negative = outflow (matches our convention)
        const desc = info.transaction_subject || info.transaction_note
          || t.payer_info?.email_address
          || t.cart_info?.item_details?.[0]?.item_name
          || 'PayPal transaction';
        const merchant = normalizeMerchant(desc);
        const categoryName = categorize(merchant, desc, amount);
        const categoryId = catByName.get(categoryName) ?? catByName.get('Other');
        const externalId = `paypal:${id}`;
        const hash = txnHash({ accountId: acct.id, date, amount, rawDescription: desc });
        try {
          await prisma.transaction.create({
            data: {
              accountId: acct.id, plaidTxId: externalId,
              hash, date, amount,
              rawDescription: desc, merchant, categoryId,
              pending: info.transaction_status === 'P',
              isTransfer: categoryName === 'Transfers',
            },
          });
          added++;
        } catch {
          await prisma.transaction.updateMany({
            where: { plaidTxId: externalId },
            data: { amount, rawDescription: desc, pending: info.transaction_status === 'P' },
          });
          updated++;
        }
      }
      if ((data.page ?? 1) >= (data.total_pages ?? 1) || txs.length === 0) break;
      page++;
    }
    winStart = new Date(+winEnd + 1000);
  }

  // Auto-detect transfers across all user accounts after the PayPal sync.
  if (added > 0) {
    const { pairCrossAccountTransfers } = await import('./transferPairing');
    await pairCrossAccountTransfers({ rangeDays: 3 }).catch(() => null);
  }

  return { added, updated, windows };
}

// Convenience: validate + persist + initial sync.
export async function connectPayPal(displayName: string, creds: PayPalCreds, sinceDays = 90) {
  const institutionId = await savePayPalCreds(displayName, creds);
  const sync = await syncPayPal({ institutionId, sinceDays });
  return { institutionId, ...sync };
}
