import { prisma } from './prisma';
import { ensureUserFinancialSpaces } from './financialAccess';
import { invalidateFinancialAccessCache } from './prisma';

export const DEFAULT_HOUSEHOLD_ID = 'hh_default';
const INVITE_DAYS = 14;

export class HouseholdError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type HouseholdView = {
  id: string;
  name: string;
  viewerRole: 'owner' | 'member';
  members: Array<{
    id: string;
    userId: string;
    email: string;
    name: string | null;
    role: 'owner' | 'member';
    isCurrent: boolean;
  }>;
  invites: Array<{
    id: string;
    email: string;
    role: 'owner' | 'member';
    expiresAt: string;
  }>;
};

function normalizeEmail(email: string) { return email.trim().toLowerCase(); }
function validEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

async function firstHousehold() {
  let household = await prisma.household.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!household) {
    household = await prisma.household.create({ data: { id: DEFAULT_HOUSEHOLD_ID, name: 'My Household' }, select: { id: true } });
  }
  return household;
}

/** Convert a valid email-bound invitation into membership. Idempotent. */
export async function acceptPendingHouseholdInvite(userId: string, email: string, now = new Date()): Promise<string | null> {
  const existing = await prisma.householdMember.findFirst({ where: { userId }, select: { householdId: true } });
  if (existing) {
    await ensureUserFinancialSpaces(prisma, userId);
    return existing.householdId;
  }
  const normalized = normalizeEmail(email);
  const invite = await prisma.householdInvite.findFirst({
    where: { email: normalized, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  });
  if (!invite) return null;
  await prisma.$transaction(async tx => {
    await tx.householdMember.upsert({
      where: { householdId_userId: { householdId: invite.householdId, userId } },
      update: { role: invite.role },
      create: { householdId: invite.householdId, userId, role: invite.role },
    });
    await tx.householdInvite.update({ where: { id: invite.id }, data: { acceptedAt: now } });
  });
  await ensureUserFinancialSpaces(prisma, userId);
  invalidateFinancialAccessCache();
  return invite.householdId;
}

export async function hasPendingHouseholdInvite(email: string, now = new Date()): Promise<boolean> {
  const count = await prisma.householdInvite.count({
    where: { email: normalizeEmail(email), acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
  });
  return count > 0;
}

/** Resolve membership without silently admitting an unrelated user. The first
 * user on a fresh/self-healed instance becomes owner; everyone after that must
 * arrive through an invitation. */
async function ensureHousehold(userId?: string | null): Promise<string> {
  if (userId) {
    const membership = await prisma.householdMember.findFirst({ where: { userId }, select: { householdId: true } });
    if (membership) {
      await ensureUserFinancialSpaces(prisma, userId);
      return membership.householdId;
    }
  }
  const household = await firstHousehold();
  if (!userId) return household.id;

  const [memberCount, user] = await Promise.all([
    prisma.householdMember.count({ where: { householdId: household.id } }),
    prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }),
  ]);
  if (memberCount === 0 || user?.isAdmin) {
    await prisma.householdMember.upsert({
      where: { householdId_userId: { householdId: household.id, userId } },
      update: {},
      create: { householdId: household.id, userId, role: 'owner' },
    });
    await ensureUserFinancialSpaces(prisma, userId);
    invalidateFinancialAccessCache();
    return household.id;
  }
  throw new HouseholdError('This account is not a member of the household', 403);
}

export async function currentHouseholdId(userId?: string | null): Promise<string> {
  return ensureHousehold(userId);
}

async function actorMembership(userId: string) {
  const householdId = await ensureHousehold(userId);
  const membership = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  });
  if (!membership) throw new HouseholdError('Household membership is required', 403);
  return membership;
}

async function requireOwner(userId: string) {
  const membership = await actorMembership(userId);
  if (membership.role !== 'owner') throw new HouseholdError('Only a household owner can do that', 403);
  return membership;
}

export async function getHousehold(userId?: string | null): Promise<HouseholdView | null> {
  if (!userId) return null;
  const membership = await actorMembership(userId);
  const household = await prisma.household.findUnique({
    where: { id: membership.householdId },
    include: {
      members: { include: { user: { select: { id: true, email: true, name: true } } }, orderBy: { createdAt: 'asc' } },
      invites: {
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!household) return null;
  return {
    id: household.id,
    name: household.name,
    viewerRole: membership.role as 'owner' | 'member',
    members: household.members.map(member => ({
      id: member.id,
      userId: member.userId,
      email: member.user.email,
      name: member.user.name,
      role: member.role as 'owner' | 'member',
      isCurrent: member.userId === userId,
    })),
    invites: membership.role === 'owner' ? household.invites.map(invite => ({
      id: invite.id,
      email: invite.email,
      role: invite.role as 'owner' | 'member',
      expiresAt: invite.expiresAt.toISOString(),
    })) : [],
  };
}

export async function renameHousehold(userId: string, name: string): Promise<HouseholdView | null> {
  const membership = await requireOwner(userId);
  const clean = name.trim().slice(0, 120);
  if (!clean) throw new HouseholdError('Household name is required');
  await prisma.household.update({ where: { id: membership.householdId }, data: { name: clean } });
  await prisma.financialSpace.updateMany({ where: { householdId: membership.householdId, kind: 'household' }, data: { name: `${clean} Finances` } });
  return getHousehold(userId);
}

export async function inviteHouseholdMember(userId: string, email: string, role: 'owner' | 'member' = 'member'): Promise<HouseholdView | null> {
  const membership = await requireOwner(userId);
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) throw new HouseholdError('Enter a valid email address');
  const existing = await prisma.householdMember.findFirst({
    where: { householdId: membership.householdId, user: { email: normalized } },
    select: { id: true },
  });
  if (existing) throw new HouseholdError('That person is already a household member', 409);
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  await prisma.householdInvite.upsert({
    where: { householdId_email: { householdId: membership.householdId, email: normalized } },
    create: { householdId: membership.householdId, email: normalized, role, invitedById: userId, expiresAt },
    update: { role, invitedById: userId, expiresAt, acceptedAt: null, revokedAt: null },
  });
  return getHousehold(userId);
}

export async function revokeHouseholdInvite(userId: string, inviteId: string): Promise<HouseholdView | null> {
  const membership = await requireOwner(userId);
  const result = await prisma.householdInvite.updateMany({
    where: { id: inviteId, householdId: membership.householdId, acceptedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!result.count) throw new HouseholdError('Invitation not found', 404);
  return getHousehold(userId);
}

export async function updateHouseholdMemberRole(userId: string, memberId: string, role: 'owner' | 'member'): Promise<HouseholdView | null> {
  const actor = await requireOwner(userId);
  const target = await prisma.householdMember.findFirst({ where: { id: memberId, householdId: actor.householdId } });
  if (!target) throw new HouseholdError('Household member not found', 404);
  if (target.role === 'owner' && role === 'member') {
    const ownerCount = await prisma.householdMember.count({ where: { householdId: actor.householdId, role: 'owner' } });
    if (ownerCount <= 1) throw new HouseholdError('A household must keep at least one owner', 409);
  }
  await prisma.householdMember.update({ where: { id: target.id }, data: { role } });
  await prisma.financialSpaceMember.updateMany({
    where: { userId: target.userId, space: { householdId: actor.householdId, kind: 'household' } },
    data: { role: role === 'owner' ? 'owner' : 'manager', canInvite: role === 'owner' },
  });
  invalidateFinancialAccessCache();
  return getHousehold(userId);
}

export async function removeHouseholdMember(userId: string, memberId: string): Promise<HouseholdView | null> {
  const actor = await requireOwner(userId);
  const target = await prisma.householdMember.findFirst({ where: { id: memberId, householdId: actor.householdId } });
  if (!target) throw new HouseholdError('Household member not found', 404);
  if (target.userId === userId) throw new HouseholdError('Transfer ownership before removing yourself', 409);
  if (target.role === 'owner') {
    const ownerCount = await prisma.householdMember.count({ where: { householdId: actor.householdId, role: 'owner' } });
    if (ownerCount <= 1) throw new HouseholdError('A household must keep at least one owner', 409);
  }
  // The identity and its personal/stewarded financial spaces survive leaving
  // a household. Only access to this household's shared space is revoked.
  await prisma.$transaction(async tx => {
    await tx.financialSpaceMember.deleteMany({
      where: { userId: target.userId, space: { householdId: actor.householdId, kind: 'household' } },
    });
    await tx.householdMember.delete({ where: { id: target.id } });
  });
  invalidateFinancialAccessCache();
  return getHousehold(userId);
}
