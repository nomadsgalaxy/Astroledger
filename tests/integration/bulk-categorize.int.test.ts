import { beforeEach, describe, expect, it } from 'vitest';
import { makeAccount, makeInstitution, makeTx, prisma, reset } from './_fixtures';
import { setTxCategories } from '../../src/lib/autoCategorize';

describe('bulk transaction categorization (integration)', () => {
  beforeEach(reset);

  it('applies and clears one category across the selected transaction set', async () => {
    const institution = await makeInstitution();
    const account = await makeAccount(institution.id);
    const [first, second, untouched] = await Promise.all([
      makeTx(account.id, -20),
      makeTx(account.id, -30),
      makeTx(account.id, -40),
    ]);
    const category = await prisma.category.create({ data: { name: 'Groceries' } });

    expect(await setTxCategories([first.id, second.id, first.id], category.name)).toBe(2);
    const categorized = await prisma.transaction.findMany({
      where: { id: { in: [first.id, second.id, untouched.id] } },
      select: { id: true, categoryId: true },
    });
    expect(categorized.filter(row => row.categoryId === category.id)).toHaveLength(2);
    expect(categorized.find(row => row.id === untouched.id)?.categoryId).toBeNull();

    expect(await setTxCategories([first.id, second.id], null)).toBe(2);
    expect(await prisma.transaction.count({ where: { categoryId: category.id } })).toBe(0);
  });
});
