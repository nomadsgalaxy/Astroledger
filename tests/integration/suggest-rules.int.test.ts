import { describe, it, expect, beforeEach } from 'vitest';
import { reset, makeInstitution, makeAccount, makeTx, prisma } from './_fixtures';
import { suggestRules } from '../../src/lib/suggestRules';

describe('suggestRules (integration)', () => {
  beforeEach(async () => {
    await reset();
    await prisma.rule.deleteMany({});
  });

  it('suggests a merchant→category rule when consistently categorized + uncovered', async () => {
    const inst = await makeInstitution();
    const acct = await makeAccount(inst.id);
    const coffee = await prisma.category.create({ data: { name: 'Coffee' } });
    const groceries = await prisma.category.create({ data: { name: 'Groceries' } });
    // Blue Bottle: 4× Coffee → strong signal
    for (let i = 0; i < 4; i++) await makeTx(acct.id, -6, { merchant: 'Blue Bottle', categoryId: coffee.id });
    // Costco: 2× only → below MIN_TXNS, no suggestion
    for (let i = 0; i < 2; i++) await makeTx(acct.id, -120, { merchant: 'Costco', categoryId: groceries.id });

    const s = await suggestRules();
    const bb = s.find(x => x.merchant === 'Blue Bottle');
    expect(bb).toBeTruthy();
    expect(bb!.category).toBe('Coffee');
    expect(bb!.count).toBe(4);
    expect(bb!.confidence).toBe(1);
    expect(bb!.rule.matchField).toBe('merchant');
    expect(s.find(x => x.merchant === 'Costco')).toBeUndefined(); // too few
  });

  it('skips merchants already covered by an enabled rule', async () => {
    const inst = await makeInstitution();
    const acct = await makeAccount(inst.id);
    const cat = await prisma.category.create({ data: { name: 'Coffee' } });
    for (let i = 0; i < 5; i++) await makeTx(acct.id, -6, { merchant: 'Starbucks', categoryId: cat.id });
    await prisma.rule.create({ data: { name: 'coffee', matchField: 'merchant', matchValue: 'Starbucks', applyCategory: 'Coffee' } });
    const s = await suggestRules();
    expect(s.find(x => x.merchant === 'Starbucks')).toBeUndefined();
  });

  it('does not suggest when no dominant category (split evenly)', async () => {
    const inst = await makeInstitution();
    const acct = await makeAccount(inst.id);
    const a = await prisma.category.create({ data: { name: 'A' } });
    const b = await prisma.category.create({ data: { name: 'B' } });
    for (let i = 0; i < 3; i++) await makeTx(acct.id, -10, { merchant: 'Ambiguous', categoryId: a.id });
    for (let i = 0; i < 3; i++) await makeTx(acct.id, -10, { merchant: 'Ambiguous', categoryId: b.id });
    const s = await suggestRules();
    expect(s.find(x => x.merchant === 'Ambiguous')).toBeUndefined(); // 50% < 60%
  });
});
