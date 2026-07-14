import { describe, it, expect, beforeEach } from 'vitest';
import { reset, prisma } from './_fixtures';
import { runBudgetTool } from '../../src/lib/budgetTools';

describe('audit / recent_activity (integration)', () => {
  beforeEach(reset);

  it('recent_activity returns audit rows newest-first, with writes_only filtering', async () => {
    await prisma.auditLog.create({ data: { surface: 'mcp', actor: 'token:abc', tool: 'list_accounts', isWrite: false, ok: true } });
    await new Promise(r => setTimeout(r, 5));
    await prisma.auditLog.create({ data: { surface: 'mcp', actor: 'token:abc', tool: 'reconcile_account', isWrite: true, ok: true } });
    await new Promise(r => setTimeout(r, 5));
    await prisma.auditLog.create({ data: { surface: 'chat', actor: 'session:me', tool: 'assign_to_category', isWrite: true, ok: false, error: 'boom' } });

    const all = await runBudgetTool('recent_activity', { limit: 10 }) as any[];
    expect(all).toHaveLength(3);
    expect(all[0].tool).toBe('assign_to_category'); // newest first
    expect(all[0].ok).toBe(false);
    expect(all[0].error).toBe('boom');

    const writes = await runBudgetTool('recent_activity', { writes_only: true }) as any[];
    expect(writes).toHaveLength(2);
    expect(writes.every(r => r.isWrite)).toBe(true);
  });
});
