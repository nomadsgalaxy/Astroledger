import { prisma } from './prisma';
import { chat, llmAvailable } from './llm';
import { normalizeMerchant } from './merchant';
import { txnHash } from './hash';
import { categorize } from './categorize';

const MAX_PDF_BYTES = 15 * 1024 * 1024;        // 15 MB
const MAX_TEXT_CHARS = 60_000;                  // truncate before LLM (≈ 30 statement pages)
const LLM_CHUNK_CHARS = 18_000;                 // process the PDF in chunks so each LLM call stays focused

export type ParsedTx = {
  date: string;       // YYYY-MM-DD
  description: string;
  amount: number;     // signed: negative = outflow, positive = inflow
};

export type StatementMeta = {
  endingBalance?: number;
  periodEnd?: string;  // YYYY-MM-DD
};

export type PdfImportResult = {
  parsed: number;
  inserted: number;
  skipped: number;
  llmUsed: boolean;
  warnings: string[];
  preview: ParsedTx[];
  files?: Array<{ name: string; parsed: number; inserted: number; skipped: number; error?: string }>;
};

/**
 * Parse a PDF bank statement and import its transactions.
 *
 * Pipeline:
 *   1. pdf-parse pulls plain text out of the PDF
 *   2. Local LLM (Ollama) extracts a strict-JSON transaction list
 *   3. We dedupe via the same content-hash CSV imports use, then insert
 *
 * Designed to handle any bank's layout - instead of writing per-bank regex
 * rules we lean on the LLM to identify "the table that has a date, amount,
 * and description". Fails closed when the LLM is unreachable.
 */
export async function importPdfStatement(opts: {
  buffer: Buffer;
  accountId: string;
  signConvention?: 'standard' | 'inverted';
  filename?: string;
}): Promise<PdfImportResult> {
  // ZIP magic = "PK\x03\x04"
  const isZip = opts.buffer.length > 4
    && opts.buffer[0] === 0x50 && opts.buffer[1] === 0x4B
    && opts.buffer[2] === 0x03 && opts.buffer[3] === 0x04;
  if (isZip) return importPdfZip(opts);

  if (opts.buffer.length > MAX_PDF_BYTES) {
    throw new Error(`PDF too large (max ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB)`);
  }

  // pdf-parse v3 exports a class - `new PDFParse({data}).getText()`.
  const { PDFParse } = await import('pdf-parse') as { PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text?: string }> } };
  const parsed = await new PDFParse({ data: opts.buffer }).getText();
  const fullText = (parsed.text ?? '').slice(0, MAX_TEXT_CHARS);

  if (!fullText.trim()) {
    return { parsed: 0, inserted: 0, skipped: 0, llmUsed: false, warnings: ['PDF contained no extractable text (might be a scanned image - OCR not supported yet).'], preview: [] };
  }

  // Fast path: regex-extract from common US bank statement formats. The
  // detector returns null when it can't identify the format (no period
  // header). Any non-null result - even 0 rows - is trusted, since a
  // recognized statement that legitimately has no transactions is more
  // common than the LLM finding extra ones the regex missed.
  const regexResult = extractWithRegex(fullText);
  if (regexResult !== null) {
    const result = await commitTransactions(regexResult.rows, opts, /*llmUsed=*/false, [`Used regex fast-path (recognized statement format, ${regexResult.rows.length} tx)`]);
    await maybeUpdateBalance(opts.accountId, regexResult);
    return result;
  }

  const llmReady = await llmAvailable();
  if (!llmReady) {
    return {
      parsed: 0, inserted: 0, skipped: 0, llmUsed: false,
      warnings: ['Local LLM unreachable - PDF parsing relies on it. Start Ollama and try again.'],
      preview: [],
    };
  }

  // Chunk the text. Most statements fit in one chunk; multi-page archives split.
  const chunks: string[] = [];
  for (let i = 0; i < fullText.length; i += LLM_CHUNK_CHARS) {
    chunks.push(fullText.slice(i, i + LLM_CHUNK_CHARS));
  }

  const all: ParsedTx[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const txs = await extractFromChunk(chunks[i]);
      all.push(...txs);
    } catch (err) {
      warnings.push(`Chunk ${i + 1}/${chunks.length}: ${(err as Error).message}`);
    }
  }

  if (all.length === 0) {
    warnings.unshift('LLM did not find any transactions in this PDF. The format may be unusual or the file may be password-protected.');
    return { parsed: 0, inserted: 0, skipped: 0, llmUsed: true, warnings, preview: [] };
  }

  return commitTransactions(all, opts, /*llmUsed=*/true, warnings);
}

async function commitTransactions(
  rows: ParsedTx[],
  opts: { accountId: string; signConvention?: 'standard' | 'inverted' },
  llmUsed: boolean,
  warnings: string[],
): Promise<PdfImportResult> {
  const sign = opts.signConvention === 'inverted' ? -1 : 1;
  const categories = await prisma.category.findMany();
  const catByName = new Map(categories.map(c => [c.name, c.id]));
  let inserted = 0, skipped = 0;
  for (const t of rows) {
    const amount = t.amount * sign;
    const date = new Date(t.date + 'T00:00:00Z');
    if (Number.isNaN(+date)) { skipped++; continue; }
    const rawDescription = t.description.trim().slice(0, 500);
    if (!rawDescription) { skipped++; continue; }
    const merchant = normalizeMerchant(rawDescription);
    const categoryName = categorize(merchant, rawDescription, amount);
    const categoryId = catByName.get(categoryName) ?? catByName.get('Other');
    const hash = txnHash({ accountId: opts.accountId, date, amount, rawDescription });
    try {
      await prisma.transaction.create({
        data: {
          accountId: opts.accountId,
          date, amount,
          rawDescription, merchant, categoryId,
          hash,
          isTransfer: categoryName === 'Transfers',
        },
      });
      inserted++;
    } catch {
      skipped++;
    }
  }
  // Auto-detect cross-account transfers (Pass 3 catches generic asset↔asset
  // moves like Spend→Reserve that PDF statements often describe with plain
  // descriptions like the destination account number).
  if (inserted > 0) {
    const { pairCrossAccountTransfers } = await import('./transferPairing');
    await pairCrossAccountTransfers({ rangeDays: 3 }).catch(() => null);
  }
  return { parsed: rows.length, inserted, skipped, llmUsed, warnings, preview: rows.slice(0, 10) };
}

/**
 * Regex-based statement parser. Handles US bank/credit-card formats whose
 * transaction rows start with MM/DD followed by an amount. Detects which
 * section is debit vs credit by header keywords. Year is inferred from the
 * "For the period MM/DD/YYYY to MM/DD/YYYY" line near the top of the page.
 */
function extractWithRegex(text: string): { rows: ParsedTx[]; meta: StatementMeta } | null {
  // 1. Year inference - pick the latest 4-digit year inside a date in the period line.
  const periodMatch = text.match(/For the period\s+(\d{2}\/\d{2}\/(\d{4}))\s+to\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  const startYear = periodMatch ? parseInt(periodMatch[2], 10) : null;
  const endYear   = periodMatch ? parseInt(periodMatch[5], 10) : null;
  const startMonth = periodMatch ? parseInt(periodMatch[1].slice(0, 2), 10) : null;
  const endMonth   = periodMatch ? parseInt(periodMatch[3], 10) : null;
  const endDay     = periodMatch ? parseInt(periodMatch[4], 10) : null;
  // No period header → unknown format, let LLM try.
  if (!periodMatch || !startYear || !endYear || !endMonth || !endDay) return null;

  const periodEnd = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

  // 1b. Find Ending balance - the 4th number on the line right after the
  // "Beginning balance ... Ending balance" header block.
  // PNC layout: header text wraps across ~5 lines, then a single line with
  // `1,635.65 10,989.46 2,220.15 10,404.96` (begin, deposits, withdrawals, ending).
  let endingBalance: number | undefined;
  const balanceSummaryIdx = text.indexOf('Balance Summary');
  if (balanceSummaryIdx >= 0) {
    const after = text.slice(balanceSummaryIdx, balanceSummaryIdx + 800);
    // Match a row of four amounts (any of which can be ".04" style)
    const fourNumsRx = /(\d[\d,]*\.\d{2}|\.\d{2})\s+(\d[\d,]*\.\d{2}|\.\d{2})\s+(\d[\d,]*\.\d{2}|\.\d{2})\s+(\d[\d,]*\.\d{2}|\.\d{2})/;
    const m = fourNumsRx.exec(after);
    if (m) {
      endingBalance = parseFloat(m[4].replace(/,/g, ''));
    }
  }
  // Savings/Growth-style fallback: the only summary numbers are
  // `Beginning balance ... Ending balance` with deposits/deductions
  // possibly being .00. Same regex still catches them.

  // 2. Section walker. Each known header sets the active sign for following rows.
  const sections: Array<{ rx: RegExp; sign: number }> = [
    // Debits / outflows
    { rx: /Banking\/?Debit Card Withdrawals and Purchases/i,  sign: -1 },
    { rx: /Online and Electronic Banking Deductions/i,        sign: -1 },
    { rx: /Other Deductions/i,                                sign: -1 },
    { rx: /Withdrawals/i,                                     sign: -1 },
    { rx: /Checks/i,                                          sign: -1 },
    { rx: /Purchases/i,                                       sign: -1 },
    // Credits / inflows
    { rx: /Deposits and Other Additions/i,                    sign:  1 },
    { rx: /Banking\/?Card Deposits and Credits/i,             sign:  1 },
    { rx: /Deposits/i,                                        sign:  1 },
    { rx: /Credits/i,                                         sign:  1 },
    { rx: /Interest Paid/i,                                   sign:  1 },
  ];
  const stopSections = /(Daily Balance Detail|Total for this period|Balance Summary|Account Summary|Member FDIC|Page \d+ of \d+ continued)/i;

  // 3. Walk lines. Lines that look like `MM/DD AMOUNT description…` belong to
  //    whichever section is currently active. Description can wrap to the next
  //    line(s); we coalesce continuations until the next dated row.
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const out: ParsedTx[] = [];
  let activeSign = 0;
  let buffered: { date: string; amount: number; descParts: string[] } | null = null;

  const flushBuffered = () => {
    if (!buffered) return;
    out.push({ date: buffered.date, amount: buffered.amount, description: buffered.descParts.join(' ').replace(/\s+/g, ' ').trim() });
    buffered = null;
  };

  // Amount accepts leading digit OR leading dot (savings interest like ".04")
  const dateRowRx = /^(\d{2})\/(\d{2})\s+(\d[\d,]*\.\d{2}|\.\d{2})\s+(.*)$/;

  for (const line of lines) {
    // Section header switch
    let matched = false;
    for (const s of sections) {
      if (s.rx.test(line)) { activeSign = s.sign; matched = true; flushBuffered(); break; }
    }
    if (matched) continue;
    if (stopSections.test(line)) { flushBuffered(); activeSign = 0; continue; }
    if (activeSign === 0) continue;

    const m = dateRowRx.exec(line);
    if (m) {
      flushBuffered();
      const mm = parseInt(m[1], 10);
      const dd = parseInt(m[2], 10);
      // Pick the year: months that match start of period use startYear; if month
      // is < startMonth, it crossed into the next year (e.g. Dec→Jan).
      const year = (startMonth !== null && mm < startMonth) ? endYear : startYear;
      const date = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      const amount = parseFloat(m[3].replace(/,/g, '')) * activeSign;
      buffered = { date, amount, descParts: [m[4]] };
    } else if (buffered) {
      // Continuation row - append to the current description, but stop if we
      // hit something that looks like a total or page header.
      if (/^\d{2}\/\d{2}$/.test(line)) continue;
      if (line.length > 120) continue; // unlikely to be a description fragment
      buffered.descParts.push(line);
    }
  }
  flushBuffered();
  return { rows: out, meta: { endingBalance, periodEnd } };
}

/**
 * Update bank account's stored balance from a statement, but only when the
 * incoming statement is newer than whatever we last knew. Idempotent on rerun.
 */
async function maybeUpdateBalance(accountId: string, regex: { meta: StatementMeta }) {
  if (regex.meta.endingBalance === undefined || !regex.meta.periodEnd) return;
  const acct = await prisma.bankAccount.findUnique({ where: { id: accountId } });
  if (!acct) return;
  const incomingAsOf = new Date(regex.meta.periodEnd + 'T23:59:59Z');
  if (acct.balanceAsOf && acct.balanceAsOf >= incomingAsOf) return; // we already have a fresher value
  await prisma.bankAccount.update({
    where: { id: accountId },
    data: { balance: regex.meta.endingBalance, balanceAsOf: incomingAsOf },
  });
}

/**
 * Iterate every *.pdf inside a ZIP archive. Accumulates totals across all
 * files; per-file results in `files`. One bad PDF doesn't poison the batch.
 * Same dedup as single PDFs - re-uploading the same zip is a clean no-op.
 */
async function importPdfZip(opts: {
  buffer: Buffer;
  accountId: string;
  signConvention?: 'standard' | 'inverted';
}): Promise<PdfImportResult> {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(opts.buffer);
  const entries = zip.getEntries().filter(e => !e.isDirectory && /\.pdf$/i.test(e.entryName));
  if (entries.length === 0) {
    return { parsed: 0, inserted: 0, skipped: 0, llmUsed: false, warnings: ['ZIP contained no PDF files.'], preview: [] };
  }

  let parsed = 0, inserted = 0, skipped = 0;
  const warnings: string[] = [];
  const filesReport: NonNullable<PdfImportResult['files']> = [];
  const preview: ParsedTx[] = [];
  let llmUsed = false;

  for (const entry of entries) {
    const filename = entry.entryName;
    try {
      const buf = entry.getData();
      const r = await importPdfStatement({
        buffer: buf, accountId: opts.accountId, signConvention: opts.signConvention, filename,
      });
      parsed += r.parsed; inserted += r.inserted; skipped += r.skipped;
      llmUsed = llmUsed || r.llmUsed;
      for (const w of r.warnings) warnings.push(`${filename}: ${w}`);
      filesReport.push({ name: filename, parsed: r.parsed, inserted: r.inserted, skipped: r.skipped });
      if (preview.length < 10) for (const p of r.preview) { if (preview.length >= 10) break; preview.push(p); }
    } catch (err) {
      const msg = (err as Error).message;
      warnings.push(`${filename}: ${msg}`);
      filesReport.push({ name: filename, parsed: 0, inserted: 0, skipped: 0, error: msg });
    }
  }

  return { parsed, inserted, skipped, llmUsed, warnings, preview, files: filesReport };
}

async function extractFromChunk(text: string): Promise<ParsedTx[]> {
  const sys = [
    'You extract bank transactions from raw PDF statement text. Return STRICT JSON only.',
    'Schema: {"transactions":[{"date":"YYYY-MM-DD","description":"merchant or description text","amount":<signed number>}]}',
    'Rules:',
    '- amount sign: NEGATIVE for outflows/debits/withdrawals, POSITIVE for inflows/credits/deposits.',
    '- Skip headers, summary rows, totals, balances, and page footers.',
    '- If a year is missing on a row, infer it from the statement period in the document.',
    '- Return [] if you find nothing transaction-like.',
    '- Do NOT invent transactions that are not in the text.',
  ].join('\n');

  const res = await chat([
    { role: 'system', content: sys },
    { role: 'user',   content: `Extract every transaction in this statement text:\n\n${text}` },
  ], { responseFormat: 'json_object', temperature: 0 });

  let parsed: { transactions?: ParsedTx[] };
  try { parsed = JSON.parse(res.content || '{}'); }
  catch { throw new Error('LLM returned non-JSON: ' + res.content.slice(0, 200)); }
  return (parsed.transactions ?? []).filter(t =>
    typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)
    && typeof t.description === 'string'
    && typeof t.amount === 'number' && !Number.isNaN(t.amount)
  );
}
