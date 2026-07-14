import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma, reset } from './_fixtures';
import { applyFinancialScope, ensureUserFinancialSpaces, resolveRequestAccess, type RequestAccess } from '../../src/lib/financialAccess';
import {
  cancelSuccession, inviteFinancialSpaceMember, requestSuccession,
  updateFinancialSpaceMember, updateSuccessionPlan,
} from '../../src/lib/financialSpaces';
import { notifyUser, recordSpaceEvent } from '../../src/lib/spaceEvents';

function scopedFor(access: RequestAccess) {
  const raw = new PrismaClient();
  const scoped = raw.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
    return query(await applyFinancialScope(model, operation, args, access));
  } } } });
  return { raw, scoped };
}

async function ownerWithSession() {
  const owner = await prisma.user.create({ data: { email: 'owner@example.com', name: 'Owner' } });
  const household = await prisma.household.create({ data: { name: 'Family' } });
  await prisma.householdMember.create({ data: { householdId: household.id, userId: owner.id, role: 'owner' } });
  await ensureUserFinancialSpaces(prisma, owner.id);
  const spaceId = `space_hh_${household.id}`;
  const token = `sess-${owner.id}`;
  await prisma.session.create({ data: { sessionToken: token, userId: owner.id, expires: new Date(Date.now() + 60_000) } });
  return { owner, spaceId, token };
}

describe('space audit events and notifications (integration)', () => {
  beforeEach(reset);

  it('records an audit event when a member is invited and notifies an existing user', async () => {
    const { owner, spaceId } = await ownerWithSession();
    const advisor = await prisma.user.create({ data: { email: 'advisor@example.com' } });
    await inviteFinancialSpaceMember(owner.id, spaceId, { email: advisor.email, role: 'advisor' });

    const events = await prisma.spaceAuditEvent.findMany({ where: { spaceId, action: 'member.invite' } });
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(owner.id);
    expect(events[0].summary).toContain('advisor@example.com');
    expect(events[0].at.getTime()).toBeGreaterThan(Date.now() - 60_000);

    const inbox = await prisma.spaceNotification.findMany({ where: { userId: advisor.id } });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].kind).toBe('invite');
  });

  it('captures before/after state on member permission changes', async () => {
    const { owner, spaceId } = await ownerWithSession();
    const helper = await prisma.user.create({ data: { email: 'helper@example.com' } });
    const member = await prisma.financialSpaceMember.create({ data: { spaceId, userId: helper.id, role: 'viewer' } });
    await updateFinancialSpaceMember(owner.id, spaceId, member.id, { role: 'manager', canExport: true });

    const event = await prisma.spaceAuditEvent.findFirst({ where: { spaceId, action: 'member.update' } });
    expect(JSON.parse(event!.before!)).toMatchObject({ role: 'viewer', canExport: false });
    expect(JSON.parse(event!.after!)).toMatchObject({ role: 'manager', canExport: true });
    expect(await prisma.spaceNotification.count({ where: { userId: helper.id, kind: 'permission' } })).toBe(1);
  });

  it('shows audit events only to admins of the active space and blocks every write', async () => {
    const { owner, spaceId, token } = await ownerWithSession();
    const viewer = await prisma.user.create({ data: { email: 'viewer@example.com' } });
    await prisma.financialSpaceMember.create({ data: { spaceId, userId: viewer.id, role: 'viewer' } });
    const viewerToken = `sess-${viewer.id}`;
    await prisma.session.create({ data: { sessionToken: viewerToken, userId: viewer.id, expires: new Date(Date.now() + 60_000) } });
    await recordSpaceEvent({ spaceId, actorId: owner.id, action: 'space.rename', summary: 'Renamed' });

    const ownerAccess = (await resolveRequestAccess(prisma, token, spaceId))!;
    const viewerAccess = (await resolveRequestAccess(prisma, viewerToken, spaceId))!;
    const personalAccess = (await resolveRequestAccess(prisma, token, `space_personal_${owner.id}`))!;
    const { raw, scoped } = scopedFor(ownerAccess);
    const viewerClient = scopedFor(viewerAccess);
    const personalClient = scopedFor(personalAccess);
    try {
      expect(await scoped.spaceAuditEvent.count()).toBe(1);
      expect(await viewerClient.scoped.spaceAuditEvent.count()).toBe(0);
      // Owner of a different active space cannot read another space's trail.
      expect(await personalClient.scoped.spaceAuditEvent.count({ where: { spaceId } })).toBe(0);
      // Append-only: no session can rewrite or remove history.
      expect((await scoped.spaceAuditEvent.updateMany({ data: { summary: 'tampered' } })).count).toBe(0);
      expect((await scoped.spaceAuditEvent.deleteMany({})).count).toBe(0);
      await expect(scoped.spaceAuditEvent.create({
        data: { spaceId, actorId: owner.id, action: 'fake', summary: 'forged' },
      })).rejects.toBeTruthy();
    } finally {
      await raw.$disconnect();
      await viewerClient.raw.$disconnect();
      await personalClient.raw.$disconnect();
    }
  });

  it('lets a recipient read and mark their own notifications but nothing else', async () => {
    const { owner, spaceId, token } = await ownerWithSession();
    const other = await prisma.user.create({ data: { email: 'other@example.com' } });
    await ensureUserFinancialSpaces(prisma, other.id);
    await notifyUser({ spaceId, userId: owner.id, kind: 'permission', title: 'Yours' });
    await notifyUser({ spaceId, userId: other.id, kind: 'permission', title: 'Not yours' });

    const access = (await resolveRequestAccess(prisma, token, spaceId))!;
    const { raw, scoped } = scopedFor(access);
    try {
      const mine = await scoped.spaceNotification.findMany({});
      expect(mine).toHaveLength(1);
      expect(mine[0].title).toBe('Yours');
      // Mark read succeeds, but only readAt is mutable and only own rows match.
      const marked = await scoped.spaceNotification.updateMany({ data: { title: 'tampered', readAt: new Date() } as any });
      expect(marked.count).toBe(1);
      const after = await prisma.spaceNotification.findFirst({ where: { userId: owner.id } });
      expect(after!.title).toBe('Yours');
      expect(after!.readAt).not.toBeNull();
      expect((await scoped.spaceNotification.deleteMany({ where: { userId: other.id } })).count).toBe(0);
      expect(await prisma.spaceNotification.count({ where: { userId: other.id } })).toBe(1);
    } finally { await raw.$disconnect(); }
  });

  it('lets the owner cancel an in-flight succession request with a full audit trail', async () => {
    const { owner, spaceId } = await ownerWithSession();
    const successor = await prisma.user.create({ data: { email: 'next@example.com' } });
    await updateSuccessionPlan(owner.id, spaceId, { enabled: true, successors: [{ email: successor.email }] });
    const request = await requestSuccession(successor.id, spaceId, 'Owner unreachable');

    const stranger = await prisma.user.create({ data: { email: 'stranger@example.com' } });
    await expect(cancelSuccession(stranger.id, request.id)).rejects.toMatchObject({ status: 403 });

    await cancelSuccession(owner.id, request.id);
    expect((await prisma.successionRequest.findUnique({ where: { id: request.id } }))!.status).toBe('canceled');
    const event = await prisma.spaceAuditEvent.findFirst({ where: { spaceId, action: 'succession.cancel' } });
    expect(event!.actorId).toBe(owner.id);
    // The requesting successor heard about the request and its cancellation.
    expect(await prisma.spaceNotification.count({ where: { userId: successor.id, kind: 'succession' } })).toBeGreaterThanOrEqual(2);
    // A canceled request no longer blocks a new one.
    await expect(requestSuccession(successor.id, spaceId)).resolves.toBeTruthy();
  });
});
