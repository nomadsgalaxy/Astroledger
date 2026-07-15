import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, reset } from './_fixtures';
import { ensureAdminStatus } from '../../src/lib/adminPromotion';

describe('instance admin promotion (integration)', () => {
  beforeEach(async () => {
    await reset();
    delete process.env.ADMIN_EMAILS;
  });
  afterEach(() => { delete process.env.ADMIN_EMAILS; });

  async function mkUser(email: string, createdAt: Date, isAdmin = false) {
    return prisma.user.create({ data: { email, createdAt, isAdmin } });
  }

  it('self-heals a database with no admin by promoting the earliest user', async () => {
    // The exact production incident: a sole account created before the
    // isAdmin column existed, so nothing ever promoted it.
    const first = await mkUser('founder@example.com', new Date('2026-05-19'));
    const second = await mkUser('later@example.com', new Date('2026-06-01'));

    // The newer account does NOT self-promote…
    expect(await ensureAdminStatus(second.id, second.email, false)).toBe(false);
    // …the earliest one does, persistently.
    expect(await ensureAdminStatus(first.id, first.email, false)).toBe(true);
    expect((await prisma.user.findUnique({ where: { id: first.id } }))!.isAdmin).toBe(true);

    // Once an admin exists, the self-heal stays quiet for everyone else.
    expect(await ensureAdminStatus(second.id, second.email, false)).toBe(false);
    expect((await prisma.user.findUnique({ where: { id: second.id } }))!.isAdmin).toBe(false);
  });

  it('promotes anyone listed in ADMIN_EMAILS, case-insensitively', async () => {
    await mkUser('founder@example.com', new Date('2026-05-19'), true);
    const partner = await mkUser('partner@example.com', new Date('2026-06-01'));
    const outsider = await mkUser('outsider@example.com', new Date('2026-06-02'));

    process.env.ADMIN_EMAILS = ' Partner@Example.com , someone-else@example.com ';
    expect(await ensureAdminStatus(partner.id, partner.email, false)).toBe(true);
    expect((await prisma.user.findUnique({ where: { id: partner.id } }))!.isAdmin).toBe(true);
    expect(await ensureAdminStatus(outsider.id, outsider.email, false)).toBe(false);
  });

  it('an existing admin flag short-circuits without touching the database', async () => {
    const user = await mkUser('founder@example.com', new Date('2026-05-19'), true);
    expect(await ensureAdminStatus(user.id, user.email, true)).toBe(true);
  });
});
