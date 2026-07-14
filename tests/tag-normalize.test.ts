import { describe, it, expect } from 'vitest';
import { normalizeTagAttach } from '@/lib/tagNormalize';

// Catalog used across all the cases. Two primaries (Subscription, Personal),
// two children of Subscription (Entertainment, SaaS), one secondary
// modifier (Reimbursable).
const catalog = [
  { id: 'p_sub', kind: 'primary'   as const, parentId: null },
  { id: 'p_per', kind: 'primary'   as const, parentId: null },
  { id: 'c_ent', kind: 'secondary' as const, parentId: 'p_sub' },
  { id: 'c_saas',kind: 'secondary' as const, parentId: 'p_sub' },
  { id: 's_reim',kind: 'secondary' as const, parentId: null },
];

describe('normalizeTagAttach', () => {
  it('connects a new tag when nothing is attached', () => {
    const r = normalizeTagAttach({
      existingIds: [],
      incomingIds: ['p_sub'],
      catalog,
    });
    expect(r.connect).toEqual(['p_sub']);
    expect(r.disconnect).toEqual([]);
  });

  it('replaces an existing primary when a new primary is attached', () => {
    const r = normalizeTagAttach({
      existingIds: ['p_sub'],
      incomingIds: ['p_per'],
      catalog,
    });
    expect(r.connect).toEqual(['p_per']);
    expect(r.disconnect).toEqual(['p_sub']);
  });

  it('keeps the LAST incoming primary when caller asks for two at once', () => {
    const r = normalizeTagAttach({
      existingIds: [],
      incomingIds: ['p_sub', 'p_per'],
      catalog,
    });
    expect(r.connect).toEqual(['p_per']);
    expect(r.disconnect).toEqual([]);
  });

  it('drops parent when child is attached alongside it', () => {
    const r = normalizeTagAttach({
      existingIds: ['p_sub'],
      incomingIds: ['c_ent'],
      catalog,
    });
    expect(r.connect).toEqual(['c_ent']);
    expect(r.disconnect).toEqual(['p_sub']);
  });

  it('drops parent when attaching parent + child in one call', () => {
    const r = normalizeTagAttach({
      existingIds: [],
      incomingIds: ['p_sub', 'c_ent'],
      catalog,
    });
    expect(r.connect.sort()).toEqual(['c_ent']);
    expect(r.disconnect).toEqual([]);
  });

  it('allows a primary child + an unrelated secondary modifier', () => {
    const r = normalizeTagAttach({
      existingIds: [],
      incomingIds: ['c_ent', 's_reim'],
      catalog,
    });
    expect(r.connect.sort()).toEqual(['c_ent', 's_reim']);
    expect(r.disconnect).toEqual([]);
  });

  it('keeps existing secondary when a new primary arrives', () => {
    const r = normalizeTagAttach({
      existingIds: ['s_reim'],
      incomingIds: ['p_sub'],
      catalog,
    });
    expect(r.connect).toEqual(['p_sub']);
    expect(r.disconnect).toEqual([]);
  });

  it('is a no-op when attaching a tag that is already there', () => {
    const r = normalizeTagAttach({
      existingIds: ['c_ent', 's_reim'],
      incomingIds: ['c_ent'],
      catalog,
    });
    expect(r.connect).toEqual([]);
    expect(r.disconnect).toEqual([]);
  });

  it('drops existing parent when attaching a sibling child', () => {
    // Already has Subscription parent; user attaches "SaaS" child.
    // Expect parent dropped, child added.
    const r = normalizeTagAttach({
      existingIds: ['p_sub'],
      incomingIds: ['c_saas'],
      catalog,
    });
    expect(r.connect).toEqual(['c_saas']);
    expect(r.disconnect).toEqual(['p_sub']);
  });
});
