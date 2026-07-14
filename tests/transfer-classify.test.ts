import { describe, it, expect } from 'vitest';
import { classifyTransfer } from '../src/lib/transferClassify';

const T = (m: string, amount = 1000, accountKind = 'checking', raw = '') =>
  classifyTransfer({ merchant: m, rawDescription: raw, amount, accountKind });

describe('transferClassify', () => {
  // ── income that must NEVER be demoted ──
  it('keeps payroll/salary/direct-deposit as income', () => {
    expect(T('Direct Deposit - Payroll PRINTED SOLID').isTransfer).toBe(false);
    expect(T('Salary Regular Income From Printed Solid').isTransfer).toBe(false);
    expect(T('Gross Salary').isTransfer).toBe(false);
  });
  it('keeps Zelle-from-person, tax refunds, deposits, car sale as income', () => {
    expect(T('Zel From Salvatore Dragone').isTransfer).toBe(false);
    expect(T('Internal Revenue Service').isTransfer).toBe(false);
    expect(T('State of New Jersey').isTransfer).toBe(false);
    expect(T('Mobile Deposit Reference No. 082092749').isTransfer).toBe(false);
    expect(T('We Buy Any Car').isTransfer).toBe(false);
    expect(T('Reimbursements From Printed Solid').isTransfer).toBe(false); // user choice
  });

  // ── clear transfers (conservative tier) ──
  it('flags credit-card-issuer-named inflows on a depository account', () => {
    expect(T('Citi Bank').isTransfer).toBe(true);
    expect(T('PNC Visa', 200).isTransfer).toBe(true);
  });
  it('flags explicit transfer language', () => {
    expect(T('Online Transfer From 0000008176770005').isTransfer).toBe(true);
    expect(T('Tansfer To Checking').isTransfer).toBe(true); // typo handled
    expect(T('Book Trn Credit 231U801322').isTransfer).toBe(true);
    expect(T('Opening Balance').isTransfer).toBe(true);
  });
  it('flags any positive inflow on a credit/loan account', () => {
    expect(T('Some Random Merchant', 500, 'credit').isTransfer).toBe(true);
    expect(T('Whatever', 100, 'loan').isTransfer).toBe(true);
  });
  it('does NOT flag a refund (allowlist) even on a credit account', () => {
    expect(T('Refund', 50, 'credit').isTransfer).toBe(false);
  });

  // ── aggressive tier gated by opt-in ──
  it('only flags Fidelity brokerage ACH when aggressive=true', () => {
    const fid = { merchant: 'ACH Web Pmt- Moneyline FID BKG SVC LLC', rawDescription: '', amount: 1000, accountKind: 'checking' };
    expect(classifyTransfer(fid).isTransfer).toBe(false);                  // conservative: untouched
    expect(classifyTransfer(fid, { aggressive: true }).isTransfer).toBe(true);
  });

  // ── user-decided income that must stay income even in aggressive mode ──
  it('keeps Shopify revenue, RTP-received, and Reverse-ACH as income (user decision)', () => {
    const shopify = { merchant: 'Corporate ACH Transfer Shopify St- O9V7', rawDescription: '', amount: 1300, accountKind: 'checking' };
    expect(classifyTransfer(shopify, { aggressive: true }).isTransfer).toBe(false);
    const rtp = { merchant: 'Rtp Received Paypal 04/01', rawDescription: '', amount: 2197, accountKind: 'checking' };
    expect(classifyTransfer(rtp, { aggressive: true }).isTransfer).toBe(false);
    const rev = { merchant: 'Reverse ACH Web Single EFFECTIVE 06-30-23', rawDescription: '', amount: 258, accountKind: 'checking' };
    expect(classifyTransfer(rev, { aggressive: true }).isTransfer).toBe(false);
  });

  // ── card-issuer name should NOT flag an outflow or a non-depository row ──
  it('card-issuer rule is scoped to positive depository inflows', () => {
    expect(T('Citi Bank', -50, 'checking').isTransfer).toBe(false); // outflow = a real charge desc, not a payment-in
  });

  // ── ordinary spending merchants are never transfers ──
  it('leaves ordinary merchants alone', () => {
    expect(T('Dunkin Donuts', -7).isTransfer).toBe(false);
    expect(T('Amazon', -25).isTransfer).toBe(false);
    expect(T('Printed Solid', 1063).isTransfer).toBe(false); // employer name w/o payroll keyword — left as income
  });
});
