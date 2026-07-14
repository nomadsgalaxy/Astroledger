// Split-transaction utilities.
//
// A "split" transaction is a parent row (the actual bank charge, untouched)
// with N child Transaction rows linked via parentTransactionId. Children
// carry their own per-piece amount + category + tags. Rollups exclude the
// parent (isSplit=true) and include the children instead.

import { prisma } from './prisma';
import { randomUUID } from 'node:crypto';

export type SplitInput = {
  amount: number;             // signed - same sign as the parent
  merchant?: string;
  categoryName?: string;
  tagIds?: string[];
  notes?: string;
};

const EPS = 0.01;

export async function splitTransaction(parentId: string, splits: SplitInput[]): Promise<{ parentId: string; childIds: string[] }> {
  if (splits.length < 2) throw new Error('Need at least 2 splits');

  const parent = await prisma.transaction.findUnique({ where: { id: parentId } });
  if (!parent) throw new Error('Parent transaction not found');
  if (parent.parentTransactionId) throw new Error('Cannot split a child transaction - split its parent');

  // Splits must sum to the parent amount (with ε tolerance)
  const total = splits.reduce((s, x) => s + x.amount, 0);
  if (Math.abs(total - parent.amount) > EPS) {
    throw new Error(`Split amounts sum to ${total.toFixed(2)} but parent is ${parent.amount.toFixed(2)}`);
  }

  // Validate split signs match parent
  const parentSign = Math.sign(parent.amount);
  if (!splits.every(s => Math.sign(s.amount) === parentSign)) {
    throw new Error('All split amounts must have the same sign as the parent (no mixed in/out splits).');
  }

  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  const catByName = new Map(categories.map(c => [c.name, c.id]));

  return await prisma.$transaction(async (tx) => {
    // Mark parent split + clear its own category/tags (children own them now)
    await tx.transaction.update({
      where: { id: parentId },
      data: {
        isSplit: true,
        // Strip the parent's own tags since children carry their own - keeps
        // tag-based filters from showing the parent twice.
        tags: { set: [] },
      },
    });

    const childIds: string[] = [];
    for (let i = 0; i < splits.length; i++) {
      const s = splits[i];
      const child = await tx.transaction.create({
        data: {
          accountId: parent.accountId,
          date: parent.date,
          amount: s.amount,
          rawDescription: parent.rawDescription,
          merchant: s.merchant ?? parent.merchant,
          notes: s.notes ?? null,
          categoryId: s.categoryName ? catByName.get(s.categoryName) ?? null : null,
          // Each child needs a unique hash - synthesize one off the parent + index
          hash: `split:${parent.id}:${i}:${randomUUID()}`,
          parentTransactionId: parent.id,
          ...(s.tagIds && s.tagIds.length > 0 ? { tags: { connect: s.tagIds.map(id => ({ id })) } } : {}),
        },
        select: { id: true },
      });
      childIds.push(child.id);
    }
    return { parentId, childIds };
  });
}

/** Undo a split - delete child rows and clear isSplit on the parent. */
export async function unsplitTransaction(parentId: string): Promise<{ removed: number }> {
  const children = await prisma.transaction.findMany({
    where: { parentTransactionId: parentId },
    select: { id: true },
  });
  if (children.length === 0) {
    await prisma.transaction.update({ where: { id: parentId }, data: { isSplit: false } });
    return { removed: 0 };
  }
  await prisma.$transaction(async (tx) => {
    await tx.transaction.deleteMany({ where: { id: { in: children.map(c => c.id) } } });
    await tx.transaction.update({ where: { id: parentId }, data: { isSplit: false } });
  });
  return { removed: children.length };
}
