import Papa from 'papaparse';
import { prisma } from './prisma';
import { normalizeMerchant } from './merchant';
import { categorize } from './categorize';
import { txnHash } from './hash';

export type CsvImportResult = {
  inserted: number;
  skipped: number;
  rows: number;
  accountName: string;
};

function pick(row: Record<string, string>, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const k = keys.find(k => k.trim().toLowerCase() === c.toLowerCase());
    if (k && row[k] !== '' && row[k] != null) return row[k];
  }
  return undefined;
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const t = s.trim();
  // Try common formats: ISO, MM/DD/YYYY, M/D/YY
  const iso = /^\d{4}-\d{2}-\d{2}/;
  if (iso.test(t)) return new Date(t);
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    let [, m, d, y] = us;
    if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
    return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  }
  const dt = new Date(t);
  return isNaN(+dt) ? null : dt;
}

function parseAmount(row: Record<string, string>): number | null {
  // Many banks split into Debit / Credit columns; others use Amount with sign.
  const amount = pick(row, ['Amount', 'amount', 'Transaction Amount']);
  if (amount != null) {
    const n = parseFloat(amount.replace(/[$,]/g, ''));
    if (!isNaN(n)) return n;
  }
  const debit = pick(row, ['Debit', 'Withdrawal', 'Withdrawals', 'Outflow']);
  const credit = pick(row, ['Credit', 'Deposit', 'Deposits', 'Inflow']);
  if (debit) {
    const n = parseFloat(debit.replace(/[$,]/g, ''));
    if (!isNaN(n)) return -Math.abs(n);
  }
  if (credit) {
    const n = parseFloat(credit.replace(/[$,]/g, ''));
    if (!isNaN(n)) return Math.abs(n);
  }
  return null;
}

export async function importCsv(opts: {
  csvText: string;
  accountName: string;            // e.g. "Chase Checking"
  institutionName?: string;       // e.g. "Chase"
  signConvention?: 'standard' | 'inverted'; // 'inverted': positive = outflow (some banks)
}): Promise<CsvImportResult> {
  const { csvText, accountName, institutionName = accountName, signConvention = 'standard' } = opts;

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  });
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error('Could not parse CSV: ' + parsed.errors[0].message);
  }

  // Find/create institution + account
  let institution = await prisma.institution.findFirst({ where: { name: institutionName, source: 'csv' } });
  if (!institution) institution = await prisma.institution.create({
    data: { name: institutionName, source: 'csv' },
  });

  let account = await prisma.bankAccount.findFirst({
    where: { institutionId: institution.id, name: accountName },
  });
  if (!account) account = await prisma.bankAccount.create({
    data: { institutionId: institution.id, name: accountName, type: 'depository' },
  });

  // Category cache by name
  const categories = await prisma.category.findMany();
  const catByName = new Map(categories.map(c => [c.name, c.id]));

  let inserted = 0, skipped = 0;
  for (const row of parsed.data) {
    const date = parseDate(pick(row, ['Date', 'Posted Date', 'Transaction Date', 'Posting Date']));
    let amount = parseAmount(row);
    const desc = pick(row, ['Description', 'Memo', 'Details', 'Payee', 'Name', 'Original Description']);
    if (!date || amount == null || !desc) { skipped++; continue; }
    if (signConvention === 'inverted') amount = -amount;

    const merchant = normalizeMerchant(desc);
    const categoryName = categorize(merchant, desc, amount);
    const categoryId = catByName.get(categoryName) ?? catByName.get('Other');

    const hash = txnHash({ accountId: account.id, date, amount, rawDescription: desc });

    try {
      await prisma.transaction.create({
        data: {
          accountId: account.id,
          hash,
          date,
          amount,
          rawDescription: desc,
          merchant,
          categoryId,
          isTransfer: categoryName === 'Transfers',
        },
      });
      inserted++;
    } catch (e: any) {
      // unique hash collision → already imported
      skipped++;
    }
  }

  // Best-effort: try to match any anticipated rows in this account.
  if (inserted > 0) {
    const { reconcileAnticipated } = await import('./anticipatedMatch');
    await reconcileAnticipated(account.id).catch(() => null);
    const { pairCrossAccountTransfers } = await import('./transferPairing');
    await pairCrossAccountTransfers({ rangeDays: 3 }).catch(() => null);
  }

  return { inserted, skipped, rows: parsed.data.length, accountName };
}
