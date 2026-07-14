// Parse an uploaded email archive into receipt drafts.
//
// Supported inputs (auto-detected by file magic + name):
//   • single .eml file (RFC822)
//   • .mbox file (multiple emails separated by "From ..." lines)
//   • .zip containing any combination of .eml / .mbox files (recursive)
//   • Google Takeout export (it's a .zip with .mbox inside Mail/)
//
// All receipts are passed through parseReceiptGeneric() so the same per-merchant
// rules and generic Stripe-fallback that powers Gmail sync apply here too.

import { simpleParser, type ParsedMail } from 'mailparser';
import AdmZip from 'adm-zip';
import { parseReceiptGeneric, type OrderDraft } from './receiptParse';

export type ParsedReceipt = {
  draft: OrderDraft;
  messageId: string;            // stable dedup key (Message-ID header, or fallback hash)
};

const MAGIC_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04

function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).equals(MAGIC_ZIP);
}

function isMbox(buf: Buffer, name?: string): boolean {
  if (name?.toLowerCase().endsWith('.mbox')) return true;
  // mbox files start with "From " (note the space, no colon)
  return buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === 'From ';
}

/** Split an mbox buffer into individual RFC822 message buffers. */
function splitMbox(buf: Buffer): Buffer[] {
  const text = buf.toString('utf8');
  const parts = text.split(/(?:^|\r?\n)From [^\r\n]*(?:\r?\n)/);
  // First element before the first "From " is usually empty; drop empties.
  return parts.filter(p => p.trim().length > 0).map(p => Buffer.from(p, 'utf8'));
}

async function parseOneEml(buf: Buffer, externalIdFallback: string): Promise<ParsedReceipt | null> {
  let parsed: ParsedMail;
  try { parsed = await simpleParser(buf); } catch { return null; }

  const messageId = parsed.messageId?.replace(/[<>]/g, '') ?? externalIdFallback;
  const subject = parsed.subject ?? '';
  const from = (parsed.from?.text) ?? '';
  const date = parsed.date ?? new Date();
  const text = parsed.text ?? '';
  const html = typeof parsed.html === 'string' ? parsed.html : '';

  const draft = parseReceiptGeneric({
    id: `archive:${messageId}`,
    subject, from, date, text, html,
    source: 'email_archive',
  });
  if (!draft) return null;
  return { draft, messageId };
}

/** Parse an uploaded buffer into receipt drafts. Returns ALL parsable receipts. */
export async function parseEmailArchive(buf: Buffer, filename?: string): Promise<{
  drafts: ParsedReceipt[];
  scanned: number;            // total emails examined
  skipped: number;            // non-receipts
  failed: number;             // unparseable
}> {
  const emails: { buf: Buffer; path: string }[] = [];

  if (isZip(buf)) {
    const zip = new AdmZip(buf);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const name = entry.entryName.toLowerCase();
      const content = entry.getData();
      if (name.endsWith('.eml')) {
        emails.push({ buf: content, path: entry.entryName });
      } else if (name.endsWith('.mbox') || isMbox(content)) {
        for (const m of splitMbox(content)) {
          emails.push({ buf: m, path: `${entry.entryName}#${emails.length}` });
        }
      }
      // ignore everything else (attachments, html, txt that isn't email)
    }
  } else if (isMbox(buf, filename)) {
    for (const m of splitMbox(buf)) emails.push({ buf: m, path: `mbox#${emails.length}` });
  } else {
    // Treat as single .eml
    emails.push({ buf, path: filename ?? 'upload.eml' });
  }

  let skipped = 0, failed = 0;
  const drafts: ParsedReceipt[] = [];
  for (const e of emails) {
    try {
      const r = await parseOneEml(e.buf, e.path);
      if (!r) { skipped++; continue; }
      drafts.push(r);
    } catch { failed++; }
  }

  return { drafts, scanned: emails.length, skipped, failed };
}
