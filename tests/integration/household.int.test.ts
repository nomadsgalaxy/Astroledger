import { describe, it, expect, beforeEach } from 'vitest';
import { reset, prisma } from './_fixtures';
import {
  acceptPendingHouseholdInvite,
  currentHouseholdId,
  getHousehold,
  hasPendingHouseholdInvite,
  inviteHouseholdMember,
  removeHouseholdMember,
  renameHousehold,
  updateHouseholdMemberRole,
} from '../../src/lib/household';

describe('household membership (integration)', () => {
  beforeEach(reset);

  it('makes the first user the owner but does not silently admit later users', async () => {
    const first = await prisma.user.create({ data: { email: 'owner@example.com', name: 'Owner' } });
    const householdId = await currentHouseholdId(first.id);
    const view = await getHousehold(first.id);
    expect(view?.id).toBe(householdId);
    expect(view?.members[0].role).toBe('owner');

    const stranger = await prisma.user.create({ data: { email: 'stranger@example.com' } });
    await expect(currentHouseholdId(stranger.id)).rejects.toMatchObject({ status: 403 });
  });

  it('invites an exact email and converts the invitation to membership', async () => {
    const owner = await prisma.user.create({ data: { email: 'owner@example.com', name: 'Owner' } });
    await currentHouseholdId(owner.id);
    const invited = await inviteHouseholdMember(owner.id, ' Partner@Example.com ', 'member');
    expect(invited?.invites[0].email).toBe('partner@example.com');
    expect(await hasPendingHouseholdInvite('partner@example.com')).toBe(true);

    const partner = await prisma.user.create({ data: { email: 'partner@example.com', name: 'Partner' } });
    expect(await acceptPendingHouseholdInvite(partner.id, partner.email)).toBe(invited?.id);
    expect(await hasPendingHouseholdInvite(partner.email)).toBe(false);
    const view = await getHousehold(owner.id);
    expect(view?.members.map(member => member.email)).toEqual(['owner@example.com', 'partner@example.com']);
  });

  it('limits management to owners and preserves at least one owner', async () => {
    const owner = await prisma.user.create({ data: { email: 'owner@example.com' } });
    await currentHouseholdId(owner.id);
    await inviteHouseholdMember(owner.id, 'member@example.com');
    const member = await prisma.user.create({ data: { email: 'member@example.com' } });
    await acceptPendingHouseholdInvite(member.id, member.email);

    await expect(renameHousehold(member.id, 'Nope')).rejects.toMatchObject({ status: 403 });
    const view = await getHousehold(owner.id);
    const ownerMembership = view!.members.find(m => m.userId === owner.id)!;
    const memberMembership = view!.members.find(m => m.userId === member.id)!;
    await expect(updateHouseholdMemberRole(owner.id, ownerMembership.id, 'member')).rejects.toMatchObject({ status: 409 });

    const promoted = await updateHouseholdMemberRole(owner.id, memberMembership.id, 'owner');
    expect(promoted?.members.find(m => m.userId === member.id)?.role).toBe('owner');
    await updateHouseholdMemberRole(owner.id, memberMembership.id, 'member');
    const removed = await removeHouseholdMember(owner.id, memberMembership.id);
    expect(removed?.members).toHaveLength(1);
  });
});
