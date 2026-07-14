#!/usr/bin/env node
// Test PDF import end-to-end. Inlines the import logic so we don't pull in
// 'server-only' (which throws when imported outside a Next server context).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const [, , zipPath, accountId] = process.argv;
if (!zipPath || !accountId) {
  console.error('Usage: node scripts/test-pdf-import.mjs <zip-or-pdf-path> <accountId>');
  process.exit(1);
}

const prisma = new PrismaClient();

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
const OLLAMA_MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct';

async function chat(messages) {
  const res = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ollama' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      temperature: 0,
      response_format: { type: 'json_object' },
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? '';
}

function txnHash({ accountId, date, amount, rawDescription }) {
  const h = crypto.createHash('sha256');
  h.update(accountId);
  h.update(date.toISOString().slice(0, 10));
  h.update(amount.toFixed(2));
  h.update((rawDescription || '').slice(0, 200));
  return h.digest('hex').slice(0, 32);
}

function normalizeMerchant(s) {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

const SYS_PROMPT = [
  'You extract bank transactions from raw PDF statement text. Return STRICT JSON only.',
  'Schema: {"transactions":[{"date":"YYYY-MM-DD","description":"merchant or description text","amount":<signed number>}]}',
  'Rules:',
  '- amount sign: NEGATIVE for outflows/debits/withdrawals, POSITIVE for inflows/credits/deposits.',
  '- Skip headers, summary rows, totals, balances, and page footers.',
  '- If a year is missing on a row, infer it from the statement period in the document.',
  '- Return [] if you find nothing transaction-like.',
  '- Do NOT invent transactions that are not in the text.',
].join('\n');

async function parsePdfText(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const out = await new PDFParse({ data: buffer }).getText();
  return (out.text ?? '').slice(0, 60000);
}

// Mirror of extractWithRegex in src/lib/pdfImport.ts — kept in sync.
function extractWithRegex(text) {
  const periodMatch = text.match(/For the period\s+(\d{2}\/\d{2}\/(\d{4}))\s+to\s+(\d{2}\/\d{2}\/(\d{4}))/i);
  if (!periodMatch) return null;
  const startYear = parseInt(periodMatch[2], 10);
  const endYear   = parseInt(periodMatch[4], 10);
  const startMonth = parseInt(periodMatch[1].slice(0, 2), 10);

  const sections = [
    { rx: /Banking\/?Debit Card Withdrawals and Purchases/i,  sign: -1 },
    { rx: /Online and Electronic Banking Deductions/i,        sign: -1 },
    { rx: /Other Deductions/i,                                sign: -1 },
    { rx: /Withdrawals/i,                                     sign: -1 },
    { rx: /Checks/i,                                          sign: -1 },
    { rx: /Purchases/i,                                       sign: -1 },
    { rx: /Deposits and Other Additions/i,                    sign:  1 },
    { rx: /Banking\/?Card Deposits and Credits/i,             sign:  1 },
    { rx: /Deposits/i,                                        sign:  1 },
    { rx: /Credits/i,                                         sign:  1 },
    { rx: /Interest Paid/i,                                   sign:  1 },
  ];
  const stopSections = /(Daily Balance Detail|Total for this period|Balance Summary|Account Summary|Member FDIC|Page \d+ of \d+ continued)/i;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  let activeSign = 0;
  let buffered = null;
  const flushBuffered = () => {
    if (!buffered) return;
    out.push({ date: buffered.date, amount: buffered.amount, description: buffered.descParts.join(' ').replace(/\s+/g, ' ').trim() });
    buffered = null;
  };
  const dateRowRx = /^(\d{2})\/(\d{2})\s+(\d[\d,]*\.\d{2}|\.\d{2})\s+(.*)$/;

  for (const line of lines) {
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
      const year = mm < startMonth ? endYear : startYear;
      const date = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      const amount = parseFloat(m[3].replace(/,/g, '')) * activeSign;
      buffered = { date, amount, descParts: [m[4]] };
    } else if (buffered) {
      if (/^\d{2}\/\d{2}$/.test(line)) continue;
      if (line.length > 120) continue;
      buffered.descParts.push(line);
    }
  }
  flushBuffered();
  return out;
}

async function extractFromText(text, name) {
  const LLM_CHUNK_CHARS = 18000;
  const chunks = [];
  for (let i = 0; i < text.length; i += LLM_CHUNK_CHARS) chunks.push(text.slice(i, i + LLM_CHUNK_CHARS));
  const all = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    try {
      const content = await chat([
        { role: 'system', content: SYS_PROMPT },
        { role: 'user',   content: `Extract every transaction in this statement text:\n\n${chunks[ci]}` },
      ]);
      const parsed = JSON.parse(content);
      for (const t of parsed.transactions ?? []) {
        if (typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)
            && typeof t.description === 'string'
            && typeof t.amount === 'number' && !Number.isNaN(t.amount)) {
          all.push(t);
        }
      }
    } catch (err) {
      console.error(`  ${name} chunk ${ci + 1}/${chunks.length}: ${err.message.slice(0, 80)}`);
    }
  }
  return all;
}

const buffer = await readFile(zipPath);
console.log(`Loaded ${path.basename(zipPath)} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`Using model ${OLLAMA_MODEL} via ${OLLAMA_BASE}`);

// Check the account exists
const account = await prisma.bankAccount.findUnique({ where: { id: accountId } });
if (!account) { console.error('Account not found'); process.exit(1); }
console.log(`Target account: ${account.name}`);

const before = await prisma.transaction.count({ where: { accountId } });
console.log(`Baseline tx for this account: ${before}\n`);

// Get tx that already exist for hash dedup
let totalParsed = 0, totalInserted = 0, totalSkipped = 0;

const zip = new AdmZip(buffer);
const entries = zip.getEntries().filter(e => !e.isDirectory && /\.pdf$/i.test(e.entryName));
console.log(`ZIP contains ${entries.length} PDF files\n`);

const start = Date.now();
for (let i = 0; i < entries.length; i++) {
  const entry = entries[i];
  const tStart = Date.now();
  process.stdout.write(`[${(i + 1).toString().padStart(2)}/${entries.length}] ${entry.entryName.padEnd(48)} `);
  try {
    const buf = entry.getData();
    const text = await parsePdfText(buf);
    if (!text.trim()) { console.log('no text'); continue; }
    // Regex fast path first — trust it whenever a period header was found
    let txs = extractWithRegex(text);
    let usedRegex = txs !== null;
    if (!usedRegex) {
      txs = await extractFromText(text, entry.entryName);
    }
    let inserted = 0, skipped = 0;
    for (const t of txs) {
      const date = new Date(t.date + 'T00:00:00Z');
      if (Number.isNaN(+date)) { skipped++; continue; }
      const rawDescription = t.description.trim().slice(0, 500);
      if (!rawDescription) { skipped++; continue; }
      const merchant = normalizeMerchant(rawDescription);
      const hash = txnHash({ accountId, date, amount: t.amount, rawDescription });
      try {
        await prisma.transaction.create({
          data: { accountId, date, amount: t.amount, rawDescription, merchant, hash },
        });
        inserted++;
      } catch { skipped++; }
    }
    totalParsed += txs.length; totalInserted += inserted; totalSkipped += skipped;
    const via = usedRegex ? 'regex' : 'llm  ';
    console.log(`[${via}] parsed=${txs.length.toString().padStart(3)} +${inserted.toString().padStart(2)} ~${skipped.toString().padStart(2)}  (${((Date.now() - tStart) / 1000).toFixed(1)}s)`);
  } catch (err) {
    console.log(`ERR ${err.message.slice(0, 60)}`);
  }
}

const after = await prisma.transaction.count({ where: { accountId } });
console.log(`\nDone in ${((Date.now() - start) / 1000 / 60).toFixed(1)} min`);
console.log(`Totals: parsed=${totalParsed} inserted=${totalInserted} skipped=${totalSkipped}`);
console.log(`Tx for this account: ${before} → ${after} (delta ${after - before})`);
await prisma.$disconnect();
