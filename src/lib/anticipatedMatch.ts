// Anticipated-transaction matcher.
// Flow:
//   1. User adds a transaction with isAnticipated=true (e.g. "Paid $45 at TJ's,
//      tipped $5") immediately after the real-world purchase.
//   2. Bank sync lands the actual charge a few days later. The bank row has
//      a noisy description ("TRADER JOE'S #421 NEW YORK NY") and may differ
//      by a few cents (rounding / tip / FX).
//   3. After every import, we sweep through anticipated rows in the affected
//      account and look for matches. For each plausible pair the LLM is asked
//      to decide; if confidence is high it merges automatically, otherwise
//      flags the pair on the bank row's notes for the user to confirm.

import { prisma } from './prisma';
import { chat, llmAvailable } from './llm';

const DATE_WINDOW_DAYS = 5;     // anticipated should be within ±5d of bank tx
const AMOUNT_TOLERANCE  = 5.00; // tolerate tip + FX rounding
const HIGH_CONFIDENCE   = 0.75; // auto-merge at/above this

type Candidate = {
  id: string;
  date: Date;
  amount: number;
  merchant: string | null;
  rawDescription: string;
  notes: string | null;
};

function daysBetween(a: Date, b: Date): number {
  return Math.abs((a.getTime() - b.getTime()) / 86_400_000);
}

// Heuristic: cheap pre-filter so we don't burn LLM calls on obvious non-matches.
function plausible(bank: Candidate, anticipated: Candidate): boolean {
  // Same sign (both outflow or both inflow)
  if (Math.sign(bank.amount) !== Math.sign(anticipated.amount)) return false;
  // Date window
  if (daysBetween(bank.date, anticipated.date) > DATE_WINDOW_DAYS) return false;
  // Amount within tolerance (cover tips: anticipated may be lower than bank)
  if (Math.abs(Math.abs(bank.amount) - Math.abs(anticipated.amount)) > AMOUNT_TOLERANCE) return false;
  return true;
}

async function askLLM(bank: Candidate, anticipated: Candidate): Promise<{ match: boolean; confidence: number; reason: string }> {
  if (!(await llmAvailable())) {
    // Heuristic fallback: amount within $0.50 and merchant initial-letters match
    const tight = Math.abs(Math.abs(bank.amount) - Math.abs(anticipated.amount)) < 0.5;
    const bm = (bank.merchant || bank.rawDescription).toLowerCase();
    const am = (anticipated.merchant || anticipated.rawDescription).toLowerCase();
    const hasOverlap = bm.length >= 3 && am.length >= 3 && (bm.includes(am.slice(0, 4)) || am.includes(bm.slice(0, 4)));
    return tight && hasOverlap
      ? { match: true, confidence: 0.6, reason: 'heuristic: amount+merchant overlap' }
      : { match: false, confidence: 0.2, reason: 'heuristic: no LLM, no clear overlap' };
  }
  const prompt = `You are a banking reconciliation assistant. Decide if these two transactions are the SAME real-world purchase.

ANTICIPATED (what the user typed in by hand right after paying):
  date:        ${anticipated.date.toISOString().slice(0, 10)}
  amount:      ${anticipated.amount.toFixed(2)}
  merchant:    ${anticipated.merchant ?? '(none)'}
  description: ${anticipated.rawDescription}
  user notes:  ${anticipated.notes ?? '(none)'}

BANK (what just arrived from the bank sync):
  date:        ${bank.date.toISOString().slice(0, 10)}
  amount:      ${bank.amount.toFixed(2)}
  merchant:    ${bank.merchant ?? '(none)'}
  description: ${bank.rawDescription}

Common patterns to recognize:
 - Bank descriptions are noisy/abbreviated ("TRADER JOE'S #421 NEW YORK NY" matches "Trader Joe's")
 - Amounts can differ by a tip (anticipated lower than bank), FX rounding, or rounding
 - Dates can differ by up to 5 days (hold/post lag)

Respond with strict JSON only:
{"match": boolean, "confidence": number_0_to_1, "reason": "one short sentence"}`;

  try {
    const { content } = await chat([
      { role: 'system', content: 'You output strict JSON only. No prose, no markdown fences.' },
      { role: 'user', content: prompt },
    ], { responseFormat: 'json_object', temperature: 0.1 });
    const parsed = JSON.parse(content);
    return {
      match: !!parsed.match,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      reason: String(parsed.reason ?? '').slice(0, 200),
    };
  } catch (e) {
    return { match: false, confidence: 0, reason: `LLM error: ${(e as Error).message}` };
  }
}

/**
 * Sweep the given account for bank txns that may match anticipated txns.
 * Bank tx = isAnticipated=false. Anticipated tx = isAnticipated=true.
 * When matched at high confidence, merges the anticipated into the bank tx
 * (preserves notes/tags/receipts, deletes the anticipated row).
 *
 * Returns counts useful for surfacing in the import response.
 */
export async function reconcileAnticipated(accountId: string): Promise<{
  examined: number; merged: number; flagged: number;
}> {
  const anticipated = await prisma.transaction.findMany({
    where: { accountId, isAnticipated: true },
    select: { id: true, date: true, amount: true, merchant: true, rawDescription: true, notes: true },
  });
  if (anticipated.length === 0) return { examined: 0, merged: 0, flagged: 0 };

  // Pull bank txns in the date-window union. Cheap: just last 60 days of real txns.
  const oldest = new Date(Math.min(...anticipated.map(a => a.date.getTime())));
  const newest = new Date(Math.max(...anticipated.map(a => a.date.getTime())));
  const since = new Date(oldest.getTime() - DATE_WINDOW_DAYS * 86_400_000);
  const until = new Date(newest.getTime() + DATE_WINDOW_DAYS * 86_400_000);
  const bankRows = await prisma.transaction.findMany({
    where: { accountId, isAnticipated: false, date: { gte: since, lte: until } },
    select: { id: true, date: true, amount: true, merchant: true, rawDescription: true, notes: true },
  });

  let merged = 0;
  let flagged = 0;
  let examined = 0;

  for (const ant of anticipated) {
    const candidates = bankRows.filter(b => plausible(b, ant));
    if (candidates.length === 0) continue;
    // Rank by date proximity then amount delta
    candidates.sort((a, b) => {
      const da = daysBetween(a.date, ant.date) - daysBetween(b.date, ant.date);
      if (Math.abs(da) > 0.01) return da;
      return Math.abs(Math.abs(a.amount) - Math.abs(ant.amount)) - Math.abs(Math.abs(b.amount) - Math.abs(ant.amount));
    });
    const best = candidates[0];
    examined++;

    const verdict = await askLLM(best, ant);
    if (verdict.match && verdict.confidence >= HIGH_CONFIDENCE) {
      // Merge: copy user-added context (notes, tags, receipts) onto the bank row,
      // delete the anticipated row.
      await prisma.$transaction(async (tx) => {
        // Pull existing receipts + tags
        const antFull = await tx.transaction.findUnique({
          where: { id: ant.id },
          select: { tags: { select: { id: true } }, receipts: { select: { id: true } } },
        });
        const mergedNotes = [
          best.notes,
          ant.notes && `[anticipated] ${ant.notes}`,
          verdict.reason && `[match] ${verdict.reason} (conf ${verdict.confidence.toFixed(2)})`,
        ].filter(Boolean).join('\n');
        await tx.transaction.update({
          where: { id: best.id },
          data: {
            notes: mergedNotes || null,
            mergedFromAnticipated: ant.id,
            tags: antFull?.tags.length ? { connect: antFull.tags } : undefined,
            // Move receipts from the anticipated tx to the bank tx
            receipts: antFull?.receipts.length
              ? { connect: antFull.receipts.map(r => ({ id: r.id })) }
              : undefined,
          },
        });
        // Disconnect the anticipated tx from those receipts is automatic via
        // re-connection above (since Receipt has 1:1 transactionId), but if any
        // were skipped we delete the anticipated row outright.
        await tx.transaction.delete({ where: { id: ant.id } });
      });
      merged++;
    } else if (verdict.match) {
      // Low-confidence match - leave both rows but flag the bank row's notes
      // so the user can resolve manually.
      const flagNote = `[possible-match] anticipated tx ${ant.id} (conf ${verdict.confidence.toFixed(2)}): ${verdict.reason}`;
      await prisma.transaction.update({
        where: { id: best.id },
        data: { notes: best.notes ? `${best.notes}\n${flagNote}` : flagNote },
      });
      flagged++;
    }
  }

  return { examined, merged, flagged };
}
