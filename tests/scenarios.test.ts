import { describe, it, expect } from 'vitest';
import { computeRunway } from '../src/lib/scenarios';

describe('computeRunway', () => {
  it('depleting: runway = liquid / |net|, with a depletion date + capped projection', () => {
    const r = computeRunway(12000, -1000, 60);
    expect(r.status).toBe('depleting');
    expect(r.runwayMonths).toBe(12);
    expect(r.annualChange).toBe(-12000);
    expect(r.depletionDate).not.toBeNull();
    // projection stops at/after $0 (won't run the full 60 months)
    expect(r.projection[r.projection.length - 1].balance).toBe(0);
    expect(r.projection.length).toBeLessThanOrEqual(13);
  });

  it('growing: net-positive → no finite runway, balance climbs', () => {
    const r = computeRunway(5000, 800, 24);
    expect(r.status).toBe('growing');
    expect(r.runwayMonths).toBeNull();
    expect(r.depletionDate).toBeNull();
    expect(r.annualChange).toBe(9600);
    expect(r.projection).toHaveLength(24);
    expect(r.projection[23].balance).toBe(5000 + 800 * 24);
  });

  it('flat: |net| under a dollar → flat, no depletion', () => {
    const r = computeRunway(3000, 0.2, 12);
    expect(r.status).toBe('flat');
    expect(r.runwayMonths).toBeNull();
  });

  it('rounds net + handles a near-zero balance depleting fast', () => {
    const r = computeRunway(500, -1000.004, 60);
    expect(r.status).toBe('depleting');
    expect(r.runwayMonths).toBe(0); // floor(500/1000) = 0
    expect(r.projection[0].balance).toBe(0);
  });
});
