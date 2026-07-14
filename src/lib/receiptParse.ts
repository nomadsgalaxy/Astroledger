// Parse a Gmail receipt message into an Order draft.
// Strategy:
//  1) Per-merchant rules (highest signal) - Amazon, DoorDash, Uber, Apple, Lyft, Instacart, Etsy, Stripe, GitHub, OpenAI…
//  2) Generic regex fallback (Total / Amount Charged)
//  3) (Optional) LLM fallback for the leftovers if the local LLM is reachable.

import type { GmailMessage } from './gmail';
import { extractBodies, htmlToText, header } from './gmail';

export type OrderDraft = {
  source: 'gmail';
  externalId: string;                // gmail message id
  merchant: string;
  orderDate: Date;
  amount: number;
  currency: string;
  items?: Array<{ name: string; qty?: number; price?: number }>;
  url?: string;
  confidence: number;                // 0..1
};

type Rule = {
  match: (ctx: ParseCtx) => boolean;
  parse: (ctx: ParseCtx) => OrderDraft | null;
};

type ParseCtx = {
  msg: GmailMessage;
  id: string;
  subject: string;
  from: string;
  fromDomain: string;
  date: Date;
  text: string;
};

function moneyRe(label: RegExp): RegExp {
  return new RegExp(label.source + String.raw`[^$0-9]{0,20}\$\s?([0-9]+(?:[,][0-9]{3})*(?:\.[0-9]{2}))`, 'i');
}
function parseMoney(s: string): number | null {
  const n = parseFloat(s.replace(/[,$]/g, ''));
  return isNaN(n) ? null : n;
}

const RULES: Rule[] = [
  // Amazon
  {
    match: c => /@amazon\.(com|co\.[a-z]+|de|ca)/i.test(c.from) && /(order|receipt)/i.test(c.subject),
    parse: c => {
      const orderIdMatch = c.subject.match(/#\s?([0-9-]{10,})/) ?? c.text.match(/order\s*#?\s*([0-9-]{10,})/i);
      const totalMatch = c.text.match(moneyRe(/order\s+total/i)) ?? c.text.match(moneyRe(/grand\s+total/i)) ?? c.text.match(moneyRe(/total/i));
      const total = totalMatch ? parseMoney(totalMatch[1]) : null;
      if (!total) return null;
      return {
        source: 'gmail', externalId: c.id, merchant: 'Amazon',
        orderDate: c.date, amount: total, currency: 'USD',
        url: orderIdMatch ? `https://www.amazon.com/gp/your-account/order-details?orderID=${orderIdMatch[1]}` : undefined,
        confidence: 0.95,
      };
    },
  },
  // DoorDash
  {
    match: c => /doordash\.com/i.test(c.from),
    parse: c => {
      const total = (c.text.match(moneyRe(/total\s+charged/i)) ?? c.text.match(moneyRe(/total/i)))?.[1];
      if (!total) return null;
      const restMatch = c.subject.match(/order from (.+?)(?:\s+\(|$)/i);
      const merchant = restMatch ? `DoorDash: ${restMatch[1].trim()}` : 'DoorDash';
      return { source: 'gmail', externalId: c.id, merchant, orderDate: c.date, amount: parseMoney(total)!, currency: 'USD', confidence: 0.9 };
    },
  },
  // Uber / Uber Eats
  {
    match: c => /@uber\.com/i.test(c.from),
    parse: c => {
      const total = (c.text.match(moneyRe(/total/i)))?.[1];
      if (!total) return null;
      const isEats = /eats/i.test(c.subject) || /eats/i.test(c.text);
      return { source: 'gmail', externalId: c.id, merchant: isEats ? 'Uber Eats' : 'Uber', orderDate: c.date, amount: parseMoney(total)!, currency: 'USD', confidence: 0.9 };
    },
  },
  // Apple (App Store, services)
  {
    match: c => /(itunes|apple)\.com$/i.test(c.fromDomain) && /receipt/i.test(c.subject),
    parse: c => {
      const total = (c.text.match(moneyRe(/total/i)))?.[1];
      if (!total) return null;
      return { source: 'gmail', externalId: c.id, merchant: 'Apple Services', orderDate: c.date, amount: parseMoney(total)!, currency: 'USD', confidence: 0.9 };
    },
  },
  // Lyft
  {
    match: c => /lyftmail\.com|@lyft\.com/i.test(c.from),
    parse: c => {
      const total = (c.text.match(moneyRe(/total/i)))?.[1];
      if (!total) return null;
      return { source: 'gmail', externalId: c.id, merchant: 'Lyft', orderDate: c.date, amount: parseMoney(total)!, currency: 'USD', confidence: 0.9 };
    },
  },
  // Instacart
  {
    match: c => /instacart\.com/i.test(c.from),
    parse: c => {
      const total = (c.text.match(moneyRe(/order\s+total/i)) ?? c.text.match(moneyRe(/total\s+charged/i)))?.[1];
      if (!total) return null;
      return { source: 'gmail', externalId: c.id, merchant: 'Instacart', orderDate: c.date, amount: parseMoney(total)!, currency: 'USD', confidence: 0.9 };
    },
  },
  // Etsy
  {
    match: c => /etsy\.com/i.test(c.from) && /order/i.test(c.subject),
    parse: c => {
      const total = (c.text.match(moneyRe(/order\s+total/i)) ?? c.text.match(moneyRe(/total/i)))?.[1];
      if (!total) return null;
      const shop = c.subject.match(/from\s+(.+?)(?:!|$)/i)?.[1];
      return { source: 'gmail', externalId: c.id, merchant: shop ? `Etsy: ${shop.trim()}` : 'Etsy', orderDate: c.date, amount: parseMoney(total)!, currency: 'USD', confidence: 0.85 };
    },
  },
  // GitHub
  {
    match: c => /github\.com/i.test(c.from) && /(receipt|payment)/i.test(c.subject),
    parse: c => {
      const total = (c.text.match(moneyRe(/total/i)) ?? c.text.match(moneyRe(/amount/i)))?.[1];
      if (!total) return null;
      return { source: 'gmail', externalId: c.id, merchant: 'GitHub', orderDate: c.date, amount: parseMoney(total)!, currency: 'USD', confidence: 0.9 };
    },
  },
  // OpenAI
  {
    match: c => /openai\.com|stripe\.com/i.test(c.from) && /openai/i.test(c.text),
    parse: c => {
      const total = (c.text.match(moneyRe(/amount\s+paid/i)) ?? c.text.match(moneyRe(/total/i)))?.[1];
      if (!total) return null;
      return { source: 'gmail', externalId: c.id, merchant: 'OpenAI', orderDate: c.date, amount: parseMoney(total)!, currency: 'USD', confidence: 0.9 };
    },
  },
  // Anthropic
  {
    match: c => /anthropic\.com|stripe\.com/i.test(c.from) && /anthropic|claude/i.test(c.text),
    parse: c => {
      const total = (c.text.match(moneyRe(/amount\s+paid/i)) ?? c.text.match(moneyRe(/total/i)))?.[1];
      if (!total) return null;
      return { source: 'gmail', externalId: c.id, merchant: 'Anthropic', orderDate: c.date, amount: parseMoney(total)!, currency: 'USD', confidence: 0.9 };
    },
  },
  // Generic Stripe-powered receipt (the From is usually the merchant)
  {
    match: c => /stripe\.com|@email\.stripe\.com/i.test(c.from) || /receipt/i.test(c.subject),
    parse: c => {
      const total = (c.text.match(moneyRe(/amount\s+paid/i)) ?? c.text.match(moneyRe(/total/i)))?.[1];
      if (!total) return null;
      const merchantMatch = c.subject.match(/receipt\s+from\s+(.+?)(?:\s+\[|$)/i);
      const merchant = merchantMatch ? merchantMatch[1].trim() : guessMerchantFromDomain(c.fromDomain);
      return { source: 'gmail', externalId: c.id, merchant, orderDate: c.date, amount: parseMoney(total)!, currency: 'USD', confidence: 0.7 };
    },
  },
];

function guessMerchantFromDomain(domain: string): string {
  const base = domain.replace(/^.*?\./, '').replace(/\.[a-z]+$/i, '');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function parseReceipt(msg: GmailMessage): OrderDraft | null {
  const subject = header(msg, 'Subject') ?? '';
  const from = header(msg, 'From') ?? '';
  const dateStr = header(msg, 'Date');
  const date = dateStr ? new Date(dateStr) : new Date(parseInt(msg.internalDate ?? '0'));
  const { text, html } = extractBodies(msg);
  return parseReceiptGeneric({ id: msg.id, subject, from, date, text, html, source: 'gmail' });
}

/**
 * Source-agnostic receipt parser. Works on emails from Gmail API, .eml files,
 * .mbox lines, or anywhere you can extract subject/from/date/body.
 */
export function parseReceiptGeneric(input: {
  id: string;
  subject: string;
  from: string;
  date: Date;
  text?: string;
  html?: string;
  source?: string;            // tag for OrderDraft.source (default 'gmail')
}): OrderDraft | null {
  const subject = input.subject ?? '';
  const from = input.from ?? '';
  const fromMatch = from.match(/<([^>]+)>/) ?? from.match(/([^\s<>]+@[^\s<>]+)/);
  const fromAddr = fromMatch?.[1] ?? from;
  const fromDomain = (fromAddr.split('@')[1] ?? '').toLowerCase();
  const date = input.date && !isNaN(+input.date) ? input.date : new Date();
  const fullText = ((input.text ?? '') + '\n' + htmlToText(input.html ?? '')).slice(0, 50000);
  const sourceTag = input.source ?? 'gmail';

  const ctx: ParseCtx = { msg: null as any, id: input.id, subject, from, fromDomain, date, text: fullText };

  for (const rule of RULES) {
    if (rule.match(ctx)) {
      const draft = rule.parse(ctx);
      if (draft && draft.amount > 0) return { ...draft, source: sourceTag as any };
    }
  }

  // Generic fallback: any "total" or "amount paid" line
  const t = fullText.match(moneyRe(/amount\s+paid/i)) ?? fullText.match(moneyRe(/grand\s+total/i)) ?? fullText.match(moneyRe(/order\s+total/i)) ?? fullText.match(moneyRe(/total/i));
  if (t) {
    const amt = parseMoney(t[1]);
    if (amt && amt > 0) {
      return {
        source: sourceTag as any, externalId: input.id,
        merchant: guessMerchantFromDomain(fromDomain) || 'Unknown',
        orderDate: date, amount: amt, currency: 'USD',
        confidence: 0.5,
      };
    }
  }
  return null;
}
