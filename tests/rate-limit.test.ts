import { describe, it, expect } from 'vitest';
import { rateLimit } from '../src/lib/rateLimit';

describe('rateLimit', () => {
  it('allows up to the limit then blocks with a retry-after', () => {
    const key = `t-${Math.random()}`; // unique key per test run
    for (let i = 0; i < 5; i++) {
      const r = rateLimit(key, 5, 60_000);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(5 - i - 1);
    }
    const blocked = rateLimit(key, 5, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('keys are independent', () => {
    const a = `a-${Math.random()}`, b = `b-${Math.random()}`;
    expect(rateLimit(a, 1, 60_000).ok).toBe(true);
    expect(rateLimit(a, 1, 60_000).ok).toBe(false); // a exhausted
    expect(rateLimit(b, 1, 60_000).ok).toBe(true);  // b independent
  });

  it('a tiny window lets events through again after it elapses', async () => {
    const key = `w-${Math.random()}`;
    expect(rateLimit(key, 1, 30).ok).toBe(true);
    expect(rateLimit(key, 1, 30).ok).toBe(false);
    await new Promise(r => setTimeout(r, 45));
    expect(rateLimit(key, 1, 30).ok).toBe(true); // window elapsed
  });
});
