import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';
import { prisma } from './prisma';
import { normalizeMerchant } from './merchant';
import { categorize } from './categorize';
import { txnHash } from './hash';

export function plaidEnabled(): boolean {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export function plaidClient(): PlaidApi {
  const env = (process.env.PLAID_ENV ?? 'sandbox') as keyof typeof PlaidEnvironments;
  const config = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!,
        'PLAID-SECRET': process.env.PLAID_SECRET!,
      },
    },
  });
  return new PlaidApi(config);
}

export async function createLinkToken(userId = 'astroledger-local-user') {
  if (!plaidEnabled()) throw new Error('Plaid not configured');
  const client = plaidClient();
  const products = (process.env.PLAID_PRODUCTS ?? 'transactions').split(',').map(p => p.trim()) as Products[];
  const countryCodes = (process.env.PLAID_COUNTRY_CODES ?? 'US').split(',').map(c => c.trim()) as CountryCode[];
  const res = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'Astroledger',
    products, country_codes: countryCodes, language: 'en',
  });
  return res.data.link_token;
}

export async function exchangePublicToken(publicToken: string, institutionDisplayName: string) {
  const client = plaidClient();
  const ex = await client.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = ex.data.access_token;
  const itemId = ex.data.item_id;

  const inst = await prisma.institution.upsert({
    where: { plaidItemId: itemId },
    update: { accessToken, name: institutionDisplayName },
    create: { plaidItemId: itemId, accessToken, name: institutionDisplayName, source: 'plaid' },
  });

  // Pull accounts
  const acc = await client.accountsGet({ access_token: accessToken });
  for (const a of acc.data.accounts) {
    await prisma.bankAccount.upsert({
      where: { plaidAccountId: a.account_id },
      update: {
        name: a.name, officialName: a.official_name ?? null,
        type: a.type, subtype: a.subtype ?? null, mask: a.mask ?? null,
        currency: a.balances.iso_currency_code ?? 'USD',
        balance: a.balances.current ?? null,
      },
      create: {
        institutionId: inst.id,
        plaidAccountId: a.account_id,
        name: a.name, officialName: a.official_name ?? null,
        type: a.type, subtype: a.subtype ?? null, mask: a.mask ?? null,
        currency: a.balances.iso_currency_code ?? 'USD',
        balance: a.balances.current ?? null,
      },
    });
  }
  return inst;
}

// Pull transactions via /transactions/sync, paging through cursors.
export async function syncTransactions(institutionId: string) {
  const inst = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!inst?.accessToken) throw new Error('Institution missing access token');
  const client = plaidClient();

  const accounts = await prisma.bankAccount.findMany({ where: { institutionId } });
  const accountByPlaidId = new Map(accounts.map(a => [a.plaidAccountId, a]));
  const cursorRow = await prisma.appSetting.findUnique({ where: { key: `plaid_cursor:${institutionId}` } });
  let cursor: string | undefined = cursorRow?.value || undefined;
  const categories = await prisma.category.findMany();
  const catByName = new Map(categories.map(c => [c.name, c.id]));

  let added = 0, modified = 0, removed = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await client.transactionsSync({ access_token: inst.accessToken, cursor });
    for (const t of res.data.added) {
      const acct = accountByPlaidId.get(t.account_id);
      if (!acct) continue;
      const desc = t.original_description || t.name || t.merchant_name || '';
      const date = new Date(t.date);
      const amount = -t.amount; // Plaid: positive = outflow → invert to match our convention
      const merchant = t.merchant_name ? t.merchant_name : normalizeMerchant(desc);
      const categoryName = categorize(merchant, desc, amount);
      const categoryId = catByName.get(categoryName) ?? catByName.get('Other');
      try {
        await prisma.transaction.create({
          data: {
            accountId: acct.id, plaidTxId: t.transaction_id,
            hash: txnHash({ accountId: acct.id, date, amount, rawDescription: desc }),
            date, amount, rawDescription: desc,
            merchant, categoryId,
            pending: t.pending,
            isTransfer: categoryName === 'Transfers',
          },
        });
        added++;
      } catch { /* dedup */ }
    }
    for (const t of res.data.modified) {
      const acct = accountByPlaidId.get(t.account_id);
      if (!acct) continue;
      await prisma.transaction.updateMany({
        where: { plaidTxId: t.transaction_id },
        data: { amount: -t.amount, pending: t.pending, rawDescription: t.original_description || t.name || '' },
      });
      modified++;
    }
    for (const r of res.data.removed) {
      if (r.transaction_id) {
        await prisma.transaction.deleteMany({ where: { plaidTxId: r.transaction_id } });
        removed++;
      }
    }
    cursor = res.data.next_cursor;
    hasMore = res.data.has_more;
  }
  if (cursor) {
    await prisma.appSetting.upsert({
      where: { key: `plaid_cursor:${institutionId}` },
      update: { value: cursor }, create: { key: `plaid_cursor:${institutionId}`, value: cursor },
    });
  }
  // Auto-detect cross-account transfers + CC payments now that fresh rows
  // have landed. Best-effort; failures don't fail the sync.
  if (added > 0) {
    const { pairCrossAccountTransfers } = await import('./transferPairing');
    await pairCrossAccountTransfers({ rangeDays: 3 }).catch(() => null);
  }
  return { added, modified, removed };
}
