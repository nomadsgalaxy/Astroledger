import { describe, expect, it } from 'vitest';
import { fmtDate } from '../src/app/_components/atoms';

describe('fmtDate', () => {
  it('treats YYYY-MM-DD as a calendar date without timezone shifting', () => {
    expect(fmtDate('2026-07-14')).toBe('Jul 14');
  });
});
