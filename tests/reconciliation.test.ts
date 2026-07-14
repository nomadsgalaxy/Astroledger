import { describe, it, expect } from 'vitest';
import { reconcileDifference, tiesOut } from '../src/lib/reconciliation';

describe('reconcileDifference', () => {
  it('is statement minus cleared, rounded to cents', () => {
    expect(reconcileDifference(100, 100)).toBe(0);
    expect(reconcileDifference(100.05, 100)).toBe(0.05);
    expect(reconcileDifference(100, 100.05)).toBe(-0.05);
    // float noise must not leak through
    expect(reconcileDifference(0.1 + 0.2, 0.3)).toBe(0);
  });
  it('handles negative (liability) balances', () => {
    expect(reconcileDifference(-500, -500)).toBe(0);
    expect(reconcileDifference(-500, -450)).toBe(-50);
  });
});

describe('tiesOut', () => {
  it('treats sub-cent residue as balanced', () => {
    expect(tiesOut(0)).toBe(true);
    expect(tiesOut(0.004)).toBe(true);
    expect(tiesOut(-0.004)).toBe(true);
  });
  it('a cent or more is out of balance', () => {
    expect(tiesOut(0.01)).toBe(false);
    expect(tiesOut(-1)).toBe(false);
  });
});
