import { describe, expect, it } from 'vitest';
import { newerThan } from '../src/lib/updateCheck';

describe('newerThan (release version compare)', () => {
  it('orders semantic versions numerically, not lexically', () => {
    expect(newerThan('0.8.0', '0.7.0')).toBe(true);
    expect(newerThan('0.7.1', '0.7.0')).toBe(true);
    expect(newerThan('0.10.0', '0.9.0')).toBe(true); // lexical compare would fail this
    expect(newerThan('1.0.0', '0.99.99')).toBe(true);
    expect(newerThan('0.7.0', '0.7.0')).toBe(false);
    expect(newerThan('0.6.9', '0.7.0')).toBe(false);
  });

  it('tolerates v-prefixes and short versions', () => {
    expect(newerThan('v0.8.0', '0.7.0')).toBe(true);
    expect(newerThan('0.8', '0.7.9')).toBe(true);
    expect(newerThan('garbage', '0.7.0')).toBe(false);
  });
});
