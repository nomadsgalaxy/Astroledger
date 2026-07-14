import { describe, it, expect } from 'vitest';
import { maskCurrency, CURRENCY_RE } from '@/lib/privacy';

describe('maskCurrency', () => {
  it('replaces digits in a basic $ amount', () => {
    expect(maskCurrency('$2,073')).toBe('$X,XXX');
  });

  it('preserves leading sign and decimal', () => {
    expect(maskCurrency('+$8,542.16')).toBe('+$X,XXX.XX');
    expect(maskCurrency('-$1,063.00')).toBe('-$X,XXX.XX');
  });

  it('handles the unicode minus already used in the UI', () => {
    expect(maskCurrency('−$6,816')).toBe('−$X,XXX');
  });

  it('handles € £ ¥ symbols', () => {
    expect(maskCurrency('€99.50')).toBe('€XX.XX');
    expect(maskCurrency('£1,200')).toBe('£X,XXX');
    expect(maskCurrency('¥10000')).toBe('¥XXXXX');
  });

  it('only masks currency-shaped substrings, leaves other digits alone', () => {
    expect(maskCurrency('48 charges, total $1,764')).toBe('48 charges, total $X,XXX');
  });

  it('is idempotent', () => {
    const once = maskCurrency('$56,669');
    expect(maskCurrency(once)).toBe(once);
  });

  it('handles tooltips with multiple amounts', () => {
    expect(maskCurrency('04-22\n+$0.00 income\n-$194.00 spend'))
      .toBe('04-22\n+$X.XX income\n-$XXX.XX spend');
  });
});

describe('CURRENCY_RE', () => {
  it('matches currency-shaped strings', () => {
    expect(CURRENCY_RE.test('$1')).toBe(true);
    expect(CURRENCY_RE.test('+$8,542')).toBe(true);
    expect(CURRENCY_RE.test('Bank link ($1.50/yr)')).toBe(true);
  });

  it('does not match masked output (idempotency guard)', () => {
    expect(CURRENCY_RE.test('$X,XXX')).toBe(false);
    expect(CURRENCY_RE.test('+$X.XX')).toBe(false);
  });

  it('does not match prose without a currency symbol', () => {
    expect(CURRENCY_RE.test('48 transactions')).toBe(false);
    expect(CURRENCY_RE.test('the answer is 42')).toBe(false);
  });
});
