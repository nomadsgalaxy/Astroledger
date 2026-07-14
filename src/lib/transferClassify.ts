// Single-row transfer classifier. Decides whether a POSITIVE inflow (or any
// row) is actually an inter-account transfer / debt payment mis-recorded as
// income, WITHOUT needing a matching counter-leg (unlike transferPairing.ts,
// which requires both sides to exist + align).
//
// Why this exists: credit-card payments ("Citi Bank", "PNC Visa"), "Online
// Transfer From …", brokerage moves ("Moneyline FID BKG"), and "Opening
// Balance" artifacts were landing as isTransfer=false positives → counted as
// income → inflated cashflow + the 90-day forecast. The pairing matcher missed
// them because the counter-leg was on an un-synced account or outside the date
// window.
//
// Design principle: an INCOME ALLOWLIST always wins. Real income that happens
// to contain a transfer-ish word (e.g. "Zelle from Dad", a tax refund, a mobile
// deposit) is NEVER demoted. Only when a row is not allowlisted AND matches a
// transfer signal do we flag it. Pure + deterministic so it's unit-testable and
// safe to run on every ingest path + as a backfill.

export type ClassifyInput = {
  merchant?: string | null;
  rawDescription?: string | null;
  amount: number;            // signed
  accountKind?: string | null; // resolvedKind: checking|savings_*|credit|loan|investment|wallet|...
};

export type ClassifyVerdict = {
  isTransfer: boolean;
  reason: string;            // why (for audit + the review list); '' when not a transfer
};

// Income that must NEVER be reclassified as a transfer, even if another pattern
// matches. Checked against merchant + rawDescription (case-insensitive).
const INCOME_ALLOWLIST: RegExp[] = [
  /\bpayroll\b/i,
  /\bsalary\b/i,
  /\bdirect\s*dep(osit)?\b/i,
  /\bgross\s*(pay|salary)\b/i,
  /\breimburse/i,                  // user choice: reimbursements stay income
  /\bzelle?\s+from\b/i,            // person-to-person gift/income ("Zel From Dad")
  /\b(tax\s*ref|refund)\b/i,
  /\binternal\s*revenue\b/i,       // IRS refund
  /\bstate\s+of\s+new\s+jersey\b/i,
  /\bnj\s+state\s+tax\b/i,
  /\b(mobile|atm|check|branch)\s+deposit\b/i,
  /\bwe\s+buy\s+any\s+car\b/i,     // one-off car-sale income
  /\binterest\s+(payment|paid|earned)\b/i, // bank interest = income
  /\bdividend\b/i,
];

// High-precision transfer signals (description-based). Ordered; first match
// wins for the reason label.
const TRANSFER_SIGNALS: Array<{ re: RegExp; reason: string; aggressiveOnly?: boolean }> = [
  // --- conservative tier (very high precision) ---
  { re: /\bonline\s+transfer\b/i,                          reason: 'online transfer' },
  { re: /\b(transfer|t[ao]nsfer)\s+(to|from)\b/i,          reason: 'transfer to/from' }, // incl. "Tansfer" typo
  { re: /\binternal\s+transfer\b/i,                        reason: 'internal transfer' },
  { re: /\baccount\s+transfer\b/i,                         reason: 'account transfer' },
  { re: /\bbook\s+tr[an]+\s+(credit|debit)\b/i,            reason: 'book transfer' },
  { re: /\bopening\s+balance\b/i,                          reason: 'opening balance (setup artifact)' },
  { re: /\b(inst\s*xfer|^xfer\b|\bxfer\b)/i,               reason: 'xfer' },
  { re: /\bto\s+(spend|growth|reserve)\b|\bfrom\s+(spend|growth|reserve)\b/i, reason: 'named-bucket transfer' },
  // Card-issuer name AS the merchant of an inflow on a depository account =
  // a credit-card payment leg. Gated on account kind below (see classify()).
  { re: /^(citi\s*bank|citibank|pnc\s*(bank|visa)?|chase|amex|american\s+express|discover|capital\s*one|barclays|synchrony|wells\s*fargo|us\s*bank|td\s*bank)\b/i,
    reason: 'card-issuer name (likely CC payment)' },
  { re: /\b(visa|mastercard|amex)\s*(payment|pmt)?\b.*\b(payment|pmt|thank\s*you)\b/i, reason: 'card payment' },
  { re: /\bpayment\s+thank\s+you\b/i,                      reason: 'card payment thank-you' },
  // --- aggressive tier (broader) ---
  // Brokerage withdrawals into checking are moves between the user's own
  // accounts. (Shopify "Corporate ACH Transfer", "RTP received", and
  // "Reverse ACH" were considered here but are KEPT AS INCOME by user
  // decision 2026-05-31: Shopify = business revenue, RTP = money received,
  // Reverse ACH = refund — none are inter-own-account moves.)
  { re: /\bmoneyline\b|\bfid\s*bkg\s*svc\b|\bfidelity\s+(withdraw|transfer)\b/i, reason: 'brokerage (Fidelity) ACH', aggressiveOnly: true },
];

const LIABILITY_KINDS = new Set(['credit', 'loan']);
const DEPOSITORY_KINDS = new Set(['checking', 'savings_short', 'savings_long', 'wallet']);

// Whether postImport runs the aggressive tier. Conservative-only by default on
// auto-ingest (it's unattended); the backfill script opts into aggressive
// under human review. Future: surface as an AppSetting if needed.
const AUTO_AGGRESSIVE = false;

function matchesAllowlist(text: string): boolean {
  return INCOME_ALLOWLIST.some(re => re.test(text));
}

/**
 * Classify one row. `aggressive` enables the broader signal tier.
 * Returns {isTransfer, reason}.
 */
export function classifyTransfer(input: ClassifyInput, opts: { aggressive?: boolean } = {}): ClassifyVerdict {
  const text = `${input.merchant ?? ''} ${input.rawDescription ?? ''}`.trim();
  const kind = input.accountKind ?? null;

  // 1. A POSITIVE inflow on a credit/loan account is a debt payment, never
  //    income — highest-precision signal, independent of description.
  if (input.amount > 0 && kind && LIABILITY_KINDS.has(kind)) {
    // ...unless it's an allowlisted refund landing back on the card. Card
    // refunds ("payment received"/refund) are legit negative-spend, but as a
    // POSITIVE on a liability they reduce the balance the same as a payment.
    // Leave true refunds alone (allowlist), flag the rest.
    if (!matchesAllowlist(text)) return { isTransfer: true, reason: 'inflow on credit/loan account' };
  }

  // 2. Income allowlist wins over all description signals.
  if (matchesAllowlist(text)) return { isTransfer: false, reason: '' };

  // 3. Description signals. Card-issuer-name rule only fires on depository
  //    accounts (an inflow there named after a card issuer = paying that card).
  for (const sig of TRANSFER_SIGNALS) {
    if (sig.aggressiveOnly && !opts.aggressive) continue;
    if (!sig.re.test(text)) continue;
    // The card-issuer-name signal is only meaningful on a depository inflow.
    if (sig.reason.startsWith('card-issuer name')) {
      if (input.amount > 0 && (!kind || DEPOSITORY_KINDS.has(kind))) {
        return { isTransfer: true, reason: sig.reason };
      }
      continue;
    }
    return { isTransfer: true, reason: sig.reason };
  }

  return { isTransfer: false, reason: '' };
}

// Sweep recent positive inflows + flag obvious transfers/CC-payments the
// pairing matcher can't catch (one-sided). Called from postImport on every
// ingest path so future data never re-introduces the transfer-as-income bug.
// Conservative tier only on auto-ingest. Returns the count flagged.
export async function classifyRecentInflows(opts: { sinceDays?: number } = {}): Promise<number> {
  const { prisma } = await import('./prisma');
  const { resolvedKind } = await import('./accountKind');
  const since = new Date(Date.now() - (opts.sinceDays ?? 35) * 86400_000);
  const rows = await prisma.transaction.findMany({
    where: { amount: { gt: 0 }, isTransfer: false, isSplit: false, date: { gte: since } },
    select: {
      id: true, merchant: true, rawDescription: true, amount: true,
      account: { select: { kind: true, type: true } },
    },
  });
  const toFlag: string[] = [];
  for (const r of rows) {
    const kind = resolvedKind({ kind: r.account.kind, type: r.account.type });
    const v = classifyTransfer(
      { merchant: r.merchant, rawDescription: r.rawDescription, amount: r.amount, accountKind: kind },
      { aggressive: AUTO_AGGRESSIVE },
    );
    if (v.isTransfer) toFlag.push(r.id);
  }
  for (let i = 0; i < toFlag.length; i += 100) {
    await prisma.$transaction(toFlag.slice(i, i + 100).map(id =>
      prisma.transaction.update({ where: { id }, data: { isTransfer: true } })));
  }
  return toFlag.length;
}
