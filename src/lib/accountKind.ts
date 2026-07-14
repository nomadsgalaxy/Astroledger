// Account kind taxonomy - user-facing grouping. Each BankAccount has an
// optional `kind` field; when null we infer one from the imported (type,
// subtype) so the UI groups never show "Other" for known-shape accounts.

export type AccountKind =
  | 'checking'
  | 'savings_short'
  | 'savings_long'
  | 'savings_retirement'
  | 'credit'
  | 'loan'
  | 'investment'
  | 'wallet'
  | 'ecommerce'
  | 'other';

export const KIND_LABELS: Record<AccountKind, string> = {
  checking:           'Debit / Checking',
  savings_short:      'Savings - Short-term',
  savings_long:       'Savings - Long-term',
  savings_retirement: 'Savings - Retirement',
  credit:             'Credit',
  loan:               'Loan',
  investment:         'Investment',
  wallet:             'Wallet',
  ecommerce:          'Ecommerce',
  other:              'Other',
};

// Display order on the /accounts page (top → bottom).
export const KIND_ORDER: AccountKind[] = [
  'checking',
  'savings_short',
  'savings_long',
  'savings_retirement',
  'investment',
  'wallet',
  'credit',
  'loan',
  'ecommerce',
  'other',
];

/** True for kinds that count as assets (vs liabilities) in net-worth math. */
export function isAsset(k: AccountKind): boolean {
  return k !== 'credit' && k !== 'loan';
}

/**
 * Infer a kind from the source-imported type/subtype/name when the user hasn't
 * assigned one yet. Plaid populates type+subtype well; SimpleFIN tends to bucket
 * everything as `depository`, so we fall back to scanning the name.
 */
export function inferKind(
  type?: string | null,
  subtype?: string | null,
  name?: string | null,
): AccountKind {
  const t = (type ?? '').toLowerCase();
  const s = (subtype ?? '').toLowerCase();
  const n = (name ?? '').toLowerCase();

  // Explicit type/subtype wins
  if (t === 'credit' || s === 'credit card' || s === 'paypal credit') return 'credit';
  if (t === 'loan' || s.includes('mortgage') || s.includes('student') || s.includes('auto loan')) return 'loan';
  if (t === 'investment') {
    if (/(401k|403b|ira|roth|sep|simple|retirement|pension)/.test(s)) return 'savings_retirement';
    return 'investment';
  }
  if (t === 'wallet') return 'wallet';
  if (t === 'ecommerce') return 'ecommerce';
  if (t === 'depository') {
    if (s === 'savings' || s === 'money market' || s === 'cd') return 'savings_short';
    if (s === 'checking' || s === 'paypal' || s === 'prepaid') return 'checking';
    // Fall through to name-based heuristics below
  }

  // Name-based heuristics for sources that don't populate subtype well (SimpleFIN).
  // Credit-card brand names + co-branded cards (airlines, hotels, retail).
  // Carve-outs: "debit card", "gift card", "card services" (= bank's customer-service hub, not a credit card).
  if (!/\b(debit|gift|prepaid)\s*card|\bcard\s+services\b/i.test(n)) {
    if (/credit\s*card|\bcredit\b|\bvisa\b|\bmastercard\b|\bmc\b|\bamex\b|\bcc\b|\bdiscover\b/.test(n)) return 'credit';
    // Co-branded cards: airline/hotel/store cards. The word "card" alone in an
    // account name almost always means a credit card (debit accounts say
    // "checking" or "spending"; gift cards are caught above).
    if (/\bcard\b/.test(n)) return 'credit';
    // Bank brands strongly associated with credit-card products.
    if (/\bchase\s+(sapphire|freedom|slate|ink|amazon|prime|marriot|hyatt|disney|southwest|united)\b/.test(n)) return 'credit';
    if (/\b(capital\s*one|citi|barclays|synchrony|syncb|comenity)\b/.test(n)) return 'credit';
  }
  if (/mortgage|\bloan\b|auto\s*loan|student/.test(n)) return 'loan';
  if (/401k|403b|\bira\b|roth|sep|retirement|pension/.test(n)) return 'savings_retirement';
  if (/brokerage|invest|stocks|equity|etf|robinhood|fidelity\s*(brokerage)?|schwab/.test(n)) return 'investment';
  if (/savings|money\s*market|\bmm\b|\bcd\b|\bhysa\b|high\s*yield/.test(n)) return 'savings_short';
  if (/checking|debit|spending|growth/.test(n)) return 'checking';
  if (/venmo|paypal|cash\s*app|wallet/.test(n)) return 'wallet';
  if (/amazon|etsy|ebay|shopify/.test(n)) return 'ecommerce';

  if (t === 'depository') return 'checking';
  return 'other';
}

export function resolvedKind(account: { kind?: string | null; type: string; subtype?: string | null; name?: string }): AccountKind {
  if (account.kind && (account.kind as AccountKind) in KIND_LABELS) return account.kind as AccountKind;
  return inferKind(account.type, account.subtype, account.name);
}
