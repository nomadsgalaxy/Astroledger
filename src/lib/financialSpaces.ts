import { prisma, getRequestFinancialAccess, invalidateFinancialAccessCache } from './prisma';
import { ensureUserFinancialSpaces, FinancialAccessError, type RequestAccess, type SpaceRole } from './financialAccess';
import { notifySpaceMembers, notifyUser, recordSpaceEvent } from './spaceEvents';

const INVITE_DAYS = 14;
const ROLES = new Set<SpaceRole>(['owner', 'manager', 'contributor', 'viewer', 'guardian', 'beneficiary', 'advisor', 'successor']);
const LEVELS = new Set(['summary', 'view', 'manage', 'owner']);
const DOC_LEVELS = new Set(['none', 'view', 'manage']);
const ROLE_LEVEL: Record<SpaceRole, number> = {
  successor: 0, viewer: 1, beneficiary: 1, advisor: 1,
  contributor: 2, guardian: 2, manager: 2, owner: 3,
};

export class FinancialSpaceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function email(value: string) { return value.trim().toLowerCase(); }
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function role(value: string): SpaceRole {
  return (ROLES.has(value as SpaceRole) ? value : 'viewer') as SpaceRole;
}

async function membership(userId: string, spaceId: string) {
  return prisma.financialSpaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
    include: { space: true },
  });
}

async function requireSpaceOwner(userId: string, spaceId: string) {
  const member = await membership(userId, spaceId);
  if (!member || member.role !== 'owner') throw new FinancialSpaceError('Only a financial-space owner can do that', 403);
  return member;
}

async function activeMembership(userId: string) {
  const access = await getRequestFinancialAccess();
  if (!access || access.userId !== userId) throw new FinancialAccessError();
  const member = await membership(userId, access.activeSpaceId);
  if (!member) throw new FinancialAccessError();
  return { access, member };
}

export async function hasPendingFinancialSpaceInvite(address: string, now = new Date()): Promise<boolean> {
  return (await prisma.financialSpaceInvite.count({
    where: { email: email(address), acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
  })) > 0;
}

/** Accept every live email-bound space invitation for a newly authenticated user. */
export async function acceptPendingFinancialSpaceInvites(userId: string, address: string, now = new Date()): Promise<number> {
  const invites = await prisma.financialSpaceInvite.findMany({
    where: { email: email(address), acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
  });
  if (!invites.length) return 0;
  await prisma.$transaction(async tx => {
    for (const invite of invites) {
      await tx.financialSpaceMember.upsert({
        where: { spaceId_userId: { spaceId: invite.spaceId, userId } },
        create: {
          spaceId: invite.spaceId,
          userId,
          role: invite.role,
          canManageDocuments: invite.canManageDocuments,
          canExport: invite.canExport,
          canInvite: invite.canInvite,
        },
        update: {
          role: invite.role,
          canManageDocuments: invite.canManageDocuments,
          canExport: invite.canExport,
          canInvite: invite.canInvite,
        },
      });
      await tx.financialSpaceInvite.update({ where: { id: invite.id }, data: { acceptedAt: now } });
    }
  });
  await ensureUserFinancialSpaces(prisma, userId);
  for (const invite of invites) {
    await recordSpaceEvent({
      spaceId: invite.spaceId, actorId: userId, action: 'member.accept', targetType: 'member', targetId: userId,
      summary: `${address} accepted an invitation as ${invite.role}`,
      after: { role: invite.role, canManageDocuments: invite.canManageDocuments, canExport: invite.canExport, canInvite: invite.canInvite },
    });
    await notifyUser({
      spaceId: invite.spaceId, userId: invite.invitedById, kind: 'invite',
      title: `${address} accepted your invitation`, linkPath: '/spaces',
    });
  }
  invalidateFinancialAccessCache();
  return invites.length;
}

export async function getFinancialWorkspace(userId: string) {
  await ensureUserFinancialSpaces(prisma, userId);
  const access = await getRequestFinancialAccess();
  const memberships = await prisma.financialSpaceMember.findMany({
    where: { userId, space: { status: { not: 'archived' } } },
    include: { space: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!memberships.length) throw new FinancialSpaceError('No financial spaces are available', 404);
  const selected = memberships.find(m => m.spaceId === access?.activeSpaceId)
    ?? memberships.find(m => m.space.kind === 'household')
    ?? memberships[0];
  const effectiveAccess = access?.activeSpaceId === selected.spaceId ? access : null;
  const accountIds = effectiveAccess?.summaryAccountIds ?? (await prisma.bankAccount.findMany({
    where: { ownerSpaceId: selected.spaceId }, select: { id: true },
  })).map(a => a.id);
  const [members, invites, accounts, allSpaces, plan] = await Promise.all([
    prisma.financialSpaceMember.findMany({
      where: { spaceId: selected.spaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    selected.role === 'owner' || selected.canInvite ? prisma.financialSpaceInvite.findMany({
      where: { spaceId: selected.spaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }) : Promise.resolve([]),
    prisma.bankAccount.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true, name: true, officialName: true, mask: true, type: true, kind: true,
        balance: true, currency: true, ownerSpaceId: true, institutionId: true,
        institution: { select: { name: true } },
        grants: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.financialSpace.findMany({
      where: { members: { some: { userId } }, status: { not: 'archived' } },
      select: { id: true, name: true, kind: true },
      orderBy: { createdAt: 'asc' },
    }),
    (selected.role === 'owner' || selected.role === 'successor') ? prisma.spaceSuccessionPlan.findUnique({
      where: { spaceId: selected.spaceId },
      include: { successors: { orderBy: { priority: 'asc' } }, requests: { include: { approvals: true }, orderBy: { createdAt: 'desc' }, take: 10 } },
    }) : Promise.resolve(null),
  ]);
  // Owner-only audit trail; the scoped client independently enforces the same
  // admin + active-space restriction, so a mismatched active space reads empty.
  const auditEvents = selected.role === 'owner' ? await prisma.spaceAuditEvent.findMany({
    where: { spaceId: selected.spaceId }, orderBy: { at: 'desc' }, take: 50,
  }) : [];
  const directUserIds = [...new Set(accounts.flatMap(a => a.grants.map(g => g.granteeUserId).filter(Boolean) as string[]))];
  const grantUsers = directUserIds.length ? await prisma.user.findMany({
    where: { id: { in: directUserIds } }, select: { id: true, email: true, name: true },
  }) : [];
  // Workspace cards intentionally summarize every space this user belongs to,
  // while normal BankAccount reads are restricted to only the active space.
  // Fetch counts (not account data) through a parameterized query whose space
  // IDs came from the authenticated membership query above.
  const accountCounts = await Promise.all(memberships.map(async item => {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM BankAccount WHERE ownerSpaceId = ${item.spaceId}
    `;
    return { spaceId: item.spaceId, count: Number(rows[0]?.count ?? 0) };
  }));
  const countMap = new Map(accountCounts.map(item => [item.spaceId, item.count]));
  return {
    activeSpaceId: selected.spaceId,
    spaces: memberships.map(item => ({
      id: item.spaceId,
      name: item.space.name,
      kind: item.space.kind,
      role: item.role,
      accountCount: countMap.get(item.spaceId) ?? 0,
    })),
    active: {
      id: selected.space.id,
      name: selected.space.name,
      kind: selected.space.kind,
      status: selected.space.status,
      beneficiaryUserId: selected.space.beneficiaryUserId,
      role: selected.role,
      canAdmin: selected.role === 'owner',
      canInvite: selected.role === 'owner' || selected.canInvite,
      canManageDocuments: selected.role === 'owner' || selected.canManageDocuments,
      canExport: selected.role === 'owner' || selected.canExport,
    },
    members: members.map(m => ({
      id: m.id, userId: m.userId, name: m.user.name, email: m.user.email, role: m.role,
      canManageDocuments: m.canManageDocuments, canExport: m.canExport, canInvite: m.canInvite,
      isCurrent: m.userId === userId,
    })),
    invites: invites.map(i => ({
      id: i.id, email: i.email, role: i.role, canManageDocuments: i.canManageDocuments,
      canExport: i.canExport, canInvite: i.canInvite, expiresAt: i.expiresAt.toISOString(),
    })),
    accounts: accounts.map(account => ({
      ...account,
      grants: effectiveAccess?.shareAccountIds.includes(account.id) ? account.grants : [],
      accessLevel: effectiveAccess?.ownerAccountIds.includes(account.id) ? 'owner'
        : effectiveAccess?.manageAccountIds.includes(account.id) ? 'manage'
          : effectiveAccess?.viewAccountIds.includes(account.id) ? 'view' : 'summary',
      documentAccess: effectiveAccess?.documentManageAccountIds.includes(account.id) ? 'manage'
        : effectiveAccess?.documentViewAccountIds.includes(account.id) ? 'view' : 'none',
      canExport: !!effectiveAccess?.exportAccountIds.includes(account.id),
    })),
    grantUsers,
    shareTargetSpaces: allSpaces,
    succession: plan,
    auditEvents: auditEvents.map(event => ({
      id: event.id, at: event.at.toISOString(), actorId: event.actorId, action: event.action,
      summary: event.summary, reason: event.reason, before: event.before, after: event.after,
    })),
  };
}

// Raw DATETIME values come back in whatever representation the writer used
// (ISO string, "YYYY-MM-DD HH:MM:SS", or epoch millis). Normalize defensively.
function rawDate(value: unknown): string {
  if (typeof value === 'number') return new Date(value).toISOString();
  const text = String(value ?? '');
  if (/^\d+$/.test(text)) return new Date(Number(text)).toISOString();
  const parsed = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return isNaN(+parsed) ? new Date(0).toISOString() : parsed.toISOString();
}

/** Cross-space management view for the Settings household hub. Unlike
 * getFinancialWorkspace (active-space DTO), this returns every space the user
 * belongs to, with management data scaled to their role in EACH space. */
export async function getHouseholdSettingsView(userId: string) {
  await ensureUserFinancialSpaces(prisma, userId);
  const memberships = await prisma.financialSpaceMember.findMany({
    where: { userId, space: { status: { not: 'archived' } } },
    include: { space: true },
    orderBy: { createdAt: 'asc' },
  });
  const spaces = [];
  for (const membership of memberships) {
    const spaceId = membership.spaceId;
    const isOwner = membership.role === 'owner';
    const canInvite = isOwner || membership.canInvite;
    const [members, invites, accountRows, plan] = await Promise.all([
      prisma.financialSpaceMember.findMany({
        where: { spaceId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      canInvite ? prisma.financialSpaceInvite.findMany({
        where: { spaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      }) : Promise.resolve([]),
      prisma.$queryRaw<Array<{ c: bigint }>>`SELECT COUNT(*) AS c FROM BankAccount WHERE ownerSpaceId = ${spaceId}`,
      isOwner ? prisma.spaceSuccessionPlan.findUnique({
        where: { spaceId },
        include: { successors: true, requests: { where: { status: { in: ['pending', 'approved'] } }, take: 1 } },
      }) : Promise.resolve(null),
    ]);
    // Owner-only audit peek. Raw SELECT because the model guard scopes audit
    // reads to the ACTIVE space; this read is authorized per space by the
    // explicit owner check above. Security review point, like all raw SQL.
    const audit = isOwner ? await prisma.$queryRaw<Array<{ id: string; at: unknown; action: string; summary: string }>>`
      SELECT id, at, action, summary FROM SpaceAuditEvent WHERE spaceId = ${spaceId} ORDER BY at DESC LIMIT 8
    ` : [];
    spaces.push({
      id: spaceId,
      name: membership.space.name,
      kind: membership.space.kind,
      status: membership.space.status,
      beneficiaryUserId: membership.space.beneficiaryUserId,
      role: membership.role,
      canInvite,
      canAdmin: isOwner,
      accountCount: Number(accountRows[0]?.c ?? 0),
      members: members.map(member => ({
        id: member.id, userId: member.userId, name: member.user.name, email: member.user.email,
        role: member.role, canManageDocuments: member.canManageDocuments, canExport: member.canExport,
        canInvite: member.canInvite, isCurrent: member.userId === userId,
      })),
      invites: invites.map(invite => ({
        id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt.toISOString(),
      })),
      succession: plan ? {
        enabled: plan.enabled,
        successorCount: plan.successors.length,
        pendingRequest: plan.requests[0] ? { id: plan.requests[0].id, status: plan.requests[0].status } : null,
      } : null,
      recentAudit: audit.map(event => ({
        id: event.id, at: rawDate(event.at), action: event.action, summary: event.summary,
      })),
    });
  }
  return { spaces };
}

export async function getFinancialSpaceSwitcher(userId: string) {
  await ensureUserFinancialSpaces(prisma, userId);
  const [access, memberships] = await Promise.all([
    getRequestFinancialAccess(),
    prisma.financialSpaceMember.findMany({
      where: { userId, space: { status: { not: 'archived' } } },
      include: { space: { select: { id: true, name: true, kind: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const fallback = memberships.find(item => item.space.kind === 'household') ?? memberships[0];
  return {
    activeSpaceId: access?.userId === userId ? access.activeSpaceId : fallback?.spaceId ?? '',
    spaces: memberships.map(item => ({ id: item.spaceId, name: item.space.name, kind: item.space.kind, role: item.role })),
  };
}

export async function createStewardedSpace(userId: string, input: { name: string; beneficiaryEmail?: string }) {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new FinancialSpaceError('A space name is required');
  const beneficiaryAddress = input.beneficiaryEmail ? email(input.beneficiaryEmail) : '';
  if (beneficiaryAddress && !validEmail(beneficiaryAddress)) throw new FinancialSpaceError('Enter a valid beneficiary email');
  const beneficiary = beneficiaryAddress ? await prisma.user.findUnique({ where: { email: beneficiaryAddress } }) : null;
  const space = await prisma.financialSpace.create({
    data: { name, kind: 'stewarded', beneficiaryUserId: beneficiary?.id, createdById: userId },
  });
  await prisma.financialSpaceMember.create({
    data: { spaceId: space.id, userId, role: 'owner', canManageDocuments: true, canExport: true, canInvite: true },
  });
  if (beneficiary) {
    await prisma.financialSpaceMember.upsert({
      where: { spaceId_userId: { spaceId: space.id, userId: beneficiary.id } },
      create: { spaceId: space.id, userId: beneficiary.id, role: 'beneficiary' }, update: { role: 'beneficiary' },
    });
  } else if (beneficiaryAddress) {
    await prisma.financialSpaceInvite.create({
      data: { spaceId: space.id, email: beneficiaryAddress, role: 'beneficiary', invitedById: userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
    });
  }
  await recordSpaceEvent({
    spaceId: space.id, actorId: userId, action: 'space.create', targetType: 'space', targetId: space.id,
    summary: `Created stewarded space "${name}"`,
    after: { kind: 'stewarded', beneficiaryEmail: beneficiaryAddress || null },
  });
  invalidateFinancialAccessCache();
  return space;
}

export async function updateFinancialSpace(userId: string, spaceId: string, input: { name?: string }) {
  const previous = (await requireSpaceOwner(userId, spaceId)).space;
  const name = input.name?.trim().slice(0, 120);
  if (!name) throw new FinancialSpaceError('A space name is required');
  const updated = await prisma.financialSpace.update({ where: { id: spaceId }, data: { name } });
  if (previous.name !== name) {
    await recordSpaceEvent({
      spaceId, actorId: userId, action: 'space.rename', targetType: 'space', targetId: spaceId,
      summary: `Renamed "${previous.name}" to "${name}"`, before: { name: previous.name }, after: { name },
    });
  }
  return updated;
}

export async function inviteFinancialSpaceMember(userId: string, spaceId: string, input: {
  email: string; role?: string; canManageDocuments?: boolean; canExport?: boolean; canInvite?: boolean;
}) {
  const actor = await membership(userId, spaceId);
  if (!actor || (actor.role !== 'owner' && !actor.canInvite)) throw new FinancialSpaceError('Invitation permission is required', 403);
  const address = email(input.email);
  if (!validEmail(address)) throw new FinancialSpaceError('Enter a valid email address');
  const requestedRole = role(input.role ?? 'viewer');
  const actorRole = role(actor.role);
  if (ROLE_LEVEL[requestedRole] > ROLE_LEVEL[actorRole]) {
    throw new FinancialSpaceError('You cannot invite someone with more access than you have', 403);
  }
  if (actor.role !== 'owner' && (
    (!!input.canManageDocuments && !actor.canManageDocuments)
    || (!!input.canExport && !actor.canExport)
    || !!input.canInvite
  )) {
    throw new FinancialSpaceError('Only an owner can delegate permissions the inviter does not hold', 403);
  }
  const target = await prisma.user.findUnique({ where: { email: address } });
  const granted = { role: requestedRole, canManageDocuments: !!input.canManageDocuments, canExport: !!input.canExport, canInvite: !!input.canInvite };
  if (target) {
    await prisma.financialSpaceMember.upsert({
      where: { spaceId_userId: { spaceId, userId: target.id } },
      create: { spaceId, userId: target.id, ...granted },
      update: granted,
    });
    await notifyUser({
      spaceId, userId: target.id, kind: 'invite',
      title: `You were added to "${actor.space.name}" as ${requestedRole}`, linkPath: '/spaces',
    });
  } else {
    await prisma.financialSpaceInvite.upsert({
      where: { spaceId_email: { spaceId, email: address } },
      create: { spaceId, email: address, ...granted, invitedById: userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
      update: { ...granted, invitedById: userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000), acceptedAt: null, revokedAt: null },
    });
  }
  await recordSpaceEvent({
    spaceId, actorId: userId, action: 'member.invite', targetType: target ? 'member' : 'invite', targetId: target?.id ?? address,
    summary: `Invited ${address} as ${requestedRole}`, after: granted,
  });
  invalidateFinancialAccessCache();
}

export async function revokeFinancialSpaceInvite(userId: string, spaceId: string, inviteId: string) {
  const actor = await membership(userId, spaceId);
  if (!actor || (actor.role !== 'owner' && !actor.canInvite)) throw new FinancialSpaceError('Invitation permission is required', 403);
  const invite = await prisma.financialSpaceInvite.findFirst({ where: { id: inviteId, spaceId, acceptedAt: null } });
  const changed = await prisma.financialSpaceInvite.updateMany({ where: { id: inviteId, spaceId, acceptedAt: null }, data: { revokedAt: new Date() } });
  if (!changed.count) throw new FinancialSpaceError('Invitation not found', 404);
  await recordSpaceEvent({
    spaceId, actorId: userId, action: 'invite.revoke', targetType: 'invite', targetId: inviteId,
    summary: `Revoked the invitation for ${invite?.email ?? 'unknown'}`, before: invite ? { email: invite.email, role: invite.role } : undefined,
  });
}

export async function updateFinancialSpaceMember(userId: string, spaceId: string, memberId: string, input: {
  role?: string; canManageDocuments?: boolean; canExport?: boolean; canInvite?: boolean;
}) {
  await requireSpaceOwner(userId, spaceId);
  const target = await prisma.financialSpaceMember.findFirst({ where: { id: memberId, spaceId } });
  if (!target) throw new FinancialSpaceError('Member not found', 404);
  const nextRole = role(input.role ?? target.role);
  if (target.role === 'owner' && nextRole !== 'owner') {
    const owners = await prisma.financialSpaceMember.count({ where: { spaceId, role: 'owner' } });
    if (owners <= 1) throw new FinancialSpaceError('A financial space must keep at least one owner', 409);
  }
  const next = {
    role: nextRole,
    canManageDocuments: input.canManageDocuments ?? target.canManageDocuments,
    canExport: input.canExport ?? target.canExport,
    canInvite: input.canInvite ?? target.canInvite,
  };
  await prisma.financialSpaceMember.update({ where: { id: target.id }, data: next });
  await recordSpaceEvent({
    spaceId, actorId: userId, action: 'member.update', targetType: 'member', targetId: target.userId,
    summary: `Changed a member's access to ${nextRole}`,
    before: { role: target.role, canManageDocuments: target.canManageDocuments, canExport: target.canExport, canInvite: target.canInvite },
    after: next,
  });
  if (target.userId !== userId) {
    await notifyUser({ spaceId, userId: target.userId, kind: 'permission', title: 'Your access to a financial space changed', linkPath: '/spaces' });
  }
  invalidateFinancialAccessCache();
}

export async function removeFinancialSpaceMember(userId: string, spaceId: string, memberId: string) {
  await requireSpaceOwner(userId, spaceId);
  const target = await prisma.financialSpaceMember.findFirst({ where: { id: memberId, spaceId } });
  if (!target) throw new FinancialSpaceError('Member not found', 404);
  if (target.userId === userId) throw new FinancialSpaceError('Transfer ownership before removing yourself', 409);
  if (target.role === 'owner' && await prisma.financialSpaceMember.count({ where: { spaceId, role: 'owner' } }) <= 1) {
    throw new FinancialSpaceError('A financial space must keep at least one owner', 409);
  }
  await prisma.financialSpaceMember.delete({ where: { id: target.id } });
  await recordSpaceEvent({
    spaceId, actorId: userId, action: 'member.remove', targetType: 'member', targetId: target.userId,
    summary: 'Removed a member from the space',
    before: { role: target.role, canManageDocuments: target.canManageDocuments, canExport: target.canExport, canInvite: target.canInvite },
  });
  await notifyUser({ spaceId, userId: target.userId, kind: 'permission', title: 'You were removed from a financial space', linkPath: '/spaces' });
  invalidateFinancialAccessCache();
}

export async function setAccountGrant(userId: string, accountId: string, input: {
  granteeUserEmail?: string; granteeSpaceId?: string; accessLevel?: string; documentAccess?: string;
  canExport?: boolean; canShare?: boolean; expiresAt?: string | null;
}, options: { notify?: boolean } = {}) {
  const { access } = await activeMembership(userId);
  if (!access.shareAccountIds.includes(accountId)) throw new FinancialSpaceError('Account sharing permission is required', 403);
  const account = await prisma.bankAccount.findUnique({ where: { id: accountId }, select: { id: true, name: true, ownerSpaceId: true } });
  if (!account) throw new FinancialSpaceError('Account not found', 404);
  const accessLevel = LEVELS.has(input.accessLevel ?? '') ? input.accessLevel! : 'view';
  const documentAccess = DOC_LEVELS.has(input.documentAccess ?? '') ? input.documentAccess! : 'none';
  const ownsAccount = access.ownerAccountIds.includes(accountId);
  if (!ownsAccount && (accessLevel === 'owner' || input.canShare)) {
    throw new FinancialSpaceError('Only the account owner can delegate ownership or resharing rights', 403);
  }
  let granteeUserId: string | undefined;
  if (input.granteeUserEmail) {
    const target = await prisma.user.findUnique({ where: { email: email(input.granteeUserEmail) } });
    if (!target) throw new FinancialSpaceError('Invite this person to a financial space before granting an account', 409);
    granteeUserId = target.id;
  }
  if (!!granteeUserId === !!input.granteeSpaceId) throw new FinancialSpaceError('Choose exactly one person or financial space');
  if (input.granteeSpaceId) {
    const targetSpace = await membership(userId, input.granteeSpaceId);
    if (!targetSpace) throw new FinancialSpaceError('You can only share to a space you belong to', 403);
  }
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && isNaN(+expiresAt)) throw new FinancialSpaceError('Invalid expiration date');
  const data = { accessLevel, documentAccess, canExport: !!input.canExport, canShare: !!input.canShare, expiresAt, grantedById: userId };
  const previous = granteeUserId
    ? await prisma.accountGrant.findUnique({ where: { accountId_granteeUserId: { accountId, granteeUserId } } })
    : await prisma.accountGrant.findUnique({ where: { accountId_granteeSpaceId: { accountId, granteeSpaceId: input.granteeSpaceId! } } });
  const grant = granteeUserId
    ? await prisma.accountGrant.upsert({
      where: { accountId_granteeUserId: { accountId, granteeUserId } },
      create: { accountId, granteeUserId, ...data }, update: data,
    })
    : await prisma.accountGrant.upsert({
      where: { accountId_granteeSpaceId: { accountId, granteeSpaceId: input.granteeSpaceId! } },
      create: { accountId, granteeSpaceId: input.granteeSpaceId!, ...data }, update: data,
    });
  const auditSpaceId = account.ownerSpaceId ?? access.activeSpaceId;
  await recordSpaceEvent({
    spaceId: auditSpaceId, actorId: userId, action: 'grant.set', targetType: 'grant', targetId: grant.id,
    summary: `Shared account "${account.name}" at ${accessLevel} with ${granteeUserId ? 'a person' : 'a financial space'}`,
    before: previous ? { accessLevel: previous.accessLevel, documentAccess: previous.documentAccess, canExport: previous.canExport, canShare: previous.canShare, expiresAt: previous.expiresAt } : undefined,
    after: { granteeUserId: granteeUserId ?? null, granteeSpaceId: input.granteeSpaceId ?? null, ...data },
  });
  if (options.notify !== false && granteeUserId && granteeUserId !== userId) {
    await notifyUser({
      spaceId: auditSpaceId, userId: granteeUserId, kind: 'grant',
      title: `An account was shared with you (${accessLevel})`, linkPath: '/spaces',
    });
  }
  invalidateFinancialAccessCache();
  return grant;
}

export async function setAllOwnedAccountGrants(userId: string, input: {
  granteeSpaceId?: string; granteeUserEmail?: string; accessLevel?: string; documentAccess?: string; canExport?: boolean; canShare?: boolean; expiresAt?: string | null;
}) {
  const { access } = await activeMembership(userId);
  if (!access.ownerAccountIds.length) throw new FinancialSpaceError('There are no owned accounts in this space', 409);
  for (const accountId of access.ownerAccountIds) await setAccountGrant(userId, accountId, input, { notify: false });
  if (input.granteeUserEmail) {
    const grantee = await prisma.user.findUnique({ where: { email: email(input.granteeUserEmail) } });
    if (grantee && grantee.id !== userId) {
      await notifyUser({
        spaceId: access.activeSpaceId, userId: grantee.id, kind: 'grant',
        title: `${access.ownerAccountIds.length} accounts were shared with you`, linkPath: '/spaces',
      });
    }
  }
  invalidateFinancialAccessCache();
}

export async function removeAccountGrant(userId: string, accountId: string, grantId: string) {
  const { access } = await activeMembership(userId);
  if (!access.shareAccountIds.includes(accountId)) throw new FinancialSpaceError('Account sharing permission is required', 403);
  const previous = await prisma.accountGrant.findFirst({ where: { id: grantId, accountId } });
  const result = await prisma.accountGrant.deleteMany({ where: { id: grantId, accountId } });
  if (!result.count) throw new FinancialSpaceError('Grant not found', 404);
  const account = await prisma.bankAccount.findUnique({ where: { id: accountId }, select: { name: true, ownerSpaceId: true } });
  await recordSpaceEvent({
    spaceId: account?.ownerSpaceId ?? access.activeSpaceId, actorId: userId, action: 'grant.remove', targetType: 'grant', targetId: grantId,
    summary: `Removed sharing for account "${account?.name ?? accountId}"`,
    before: previous ? {
      granteeUserId: previous.granteeUserId, granteeSpaceId: previous.granteeSpaceId,
      accessLevel: previous.accessLevel, documentAccess: previous.documentAccess,
      canExport: previous.canExport, canShare: previous.canShare,
    } : undefined,
  });
  invalidateFinancialAccessCache();
}

export async function moveAccountToSpace(userId: string, accountId: string, targetSpaceId: string, accessOverride?: RequestAccess) {
  const access = accessOverride ?? (await activeMembership(userId)).access;
  if (!access.ownerAccountIds.includes(accountId)) throw new FinancialSpaceError('Account ownership is required', 403);
  await requireSpaceOwner(userId, targetSpaceId);
  const connectionRows = await prisma.$queryRaw<Array<{
    institutionId: string; ownerSpaceId: string | null; name: string; hasCredential: bigint; siblingCount: bigint;
  }>>`
    SELECT b.institutionId, b.ownerSpaceId, b.name,
           CASE WHEN i.accessToken IS NULL THEN 0 ELSE 1 END AS hasCredential,
           (SELECT COUNT(*) FROM BankAccount sibling
             WHERE sibling.institutionId = b.institutionId AND sibling.id <> b.id) AS siblingCount
      FROM BankAccount b
      JOIN Institution i ON i.id = b.institutionId
     WHERE b.id = ${accountId}
  `;
  const connection = connectionRows[0];
  if (!connection) throw new FinancialSpaceError('Account not found', 404);
  const siblingCount = Number(connection.siblingCount);
  if (Number(connection.hasCredential) > 0 && siblingCount > 0) {
    throw new FinancialSpaceError('This account shares a live bank connection with other accounts. Share it instead, or move the complete connection together.', 409);
  }
  // The global Prisma guard deliberately blocks ownerSpaceId rewrites. This
  // narrow, parameterized update is the privileged path after both ownership
  // checks above have succeeded.
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`UPDATE BankAccount SET ownerSpaceId = ${targetSpaceId} WHERE id = ${accountId}`;
    // A single-account connection moves with its account so future syncs keep
    // working. Credential-less multi-account import containers may span spaces.
    if (siblingCount === 0) {
      await tx.$executeRaw`UPDATE Institution SET ownerSpaceId = ${targetSpaceId} WHERE id = ${connection.institutionId}`;
    }
  });
  // The move is visible in both trails: departure and arrival.
  for (const spaceId of new Set([connection.ownerSpaceId, targetSpaceId].filter(Boolean) as string[])) {
    await recordSpaceEvent({
      spaceId, actorId: userId, action: 'account.move', targetType: 'account', targetId: accountId,
      summary: `Moved account "${connection.name}" between spaces`,
      before: { ownerSpaceId: connection.ownerSpaceId }, after: { ownerSpaceId: targetSpaceId },
    });
  }
  invalidateFinancialAccessCache();
}

/** Move a complete bank connection — every account plus its institution —
 * between spaces the actor owns. This is the reviewed counterpart to the
 * single-account guard that refuses to split a credentialed connection. */
export async function moveConnectionToSpace(userId: string, institutionId: string, targetSpaceId: string, accessOverride?: RequestAccess) {
  const access = accessOverride ?? (await activeMembership(userId)).access;
  await requireSpaceOwner(userId, targetSpaceId);
  const accounts = await prisma.$queryRaw<Array<{ id: string; name: string; ownerSpaceId: string | null }>>`
    SELECT id, name, ownerSpaceId FROM BankAccount WHERE institutionId = ${institutionId}
  `;
  if (!accounts.length) throw new FinancialSpaceError('Connection not found', 404);
  const notOwned = accounts.filter(account => !access.ownerAccountIds.includes(account.id));
  if (notOwned.length) {
    throw new FinancialSpaceError('You must own every account on this connection to move it', 403);
  }
  const institutionRows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT name FROM Institution WHERE id = ${institutionId}
  `;
  // Same privileged pattern as moveAccountToSpace: the global guard blocks
  // ownerSpaceId rewrites, so this narrow parameterized update runs only
  // after both ownership checks above have succeeded.
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`UPDATE BankAccount SET ownerSpaceId = ${targetSpaceId} WHERE institutionId = ${institutionId}`;
    await tx.$executeRaw`UPDATE Institution SET ownerSpaceId = ${targetSpaceId} WHERE id = ${institutionId}`;
  });
  const sourceSpaces = new Set(accounts.map(account => account.ownerSpaceId).filter(Boolean) as string[]);
  for (const spaceId of new Set([...sourceSpaces, targetSpaceId])) {
    await recordSpaceEvent({
      spaceId, actorId: userId, action: 'connection.move', targetType: 'account', targetId: institutionId,
      summary: `Moved the "${institutionRows[0]?.name ?? 'bank'}" connection (${accounts.length} account${accounts.length === 1 ? '' : 's'}) between spaces`,
      before: { spaceIds: [...sourceSpaces] }, after: { ownerSpaceId: targetSpaceId },
    });
  }
  invalidateFinancialAccessCache();
}

export async function transferSpaceOwnership(userId: string, spaceId: string, targetUserId: string) {
  await requireSpaceOwner(userId, spaceId);
  const target = await membership(targetUserId, spaceId);
  if (!target) throw new FinancialSpaceError('The new owner must already be a member', 409);
  await prisma.$transaction(async tx => {
    await tx.financialSpaceMember.update({ where: { id: target.id }, data: { role: 'owner', canManageDocuments: true, canExport: true, canInvite: true } });
    if (targetUserId !== userId) {
      await tx.financialSpaceMember.updateMany({ where: { spaceId, userId }, data: { role: 'manager', canInvite: false } });
    }
  });
  await recordSpaceEvent({
    spaceId, actorId: userId, action: 'ownership.transfer', targetType: 'member', targetId: targetUserId,
    summary: 'Transferred space ownership',
    before: { ownerUserId: userId }, after: { ownerUserId: targetUserId, previousOwnerRole: targetUserId !== userId ? 'manager' : 'owner' },
  });
  if (targetUserId !== userId) {
    await notifyUser({ spaceId, userId: targetUserId, kind: 'ownership', title: 'You are now the owner of a financial space', linkPath: '/spaces' });
  }
  invalidateFinancialAccessCache();
}

export async function grantDependentAutonomy(userId: string, spaceId: string, input: { beneficiaryUserId?: string; guardianAccess?: 'none' | 'view' | 'manage' }) {
  const space = (await requireSpaceOwner(userId, spaceId)).space;
  if (space.kind !== 'stewarded') throw new FinancialSpaceError('Only a stewarded space can be granted autonomy', 409);
  const beneficiaryUserId = input.beneficiaryUserId ?? space.beneficiaryUserId;
  if (!beneficiaryUserId) throw new FinancialSpaceError('Choose a beneficiary before granting autonomy');
  const beneficiary = await prisma.user.findUnique({ where: { id: beneficiaryUserId } });
  if (!beneficiary) throw new FinancialSpaceError('Beneficiary not found', 404);
  const beneficiaryMembership = await membership(beneficiaryUserId, spaceId);
  if (!beneficiaryMembership || (beneficiaryMembership.role !== 'beneficiary' && space.beneficiaryUserId !== beneficiaryUserId)) {
    throw new FinancialSpaceError('Invite and designate this person as the beneficiary before granting autonomy', 409);
  }
  const guardianAccess = input.guardianAccess ?? 'view';
  await prisma.$transaction(async tx => {
    await tx.financialSpace.update({ where: { id: spaceId }, data: { kind: 'personal', beneficiaryUserId } });
    await tx.financialSpaceMember.upsert({
      where: { spaceId_userId: { spaceId, userId: beneficiaryUserId } },
      create: { spaceId, userId: beneficiaryUserId, role: 'owner', canManageDocuments: true, canExport: true, canInvite: true },
      update: { role: 'owner', canManageDocuments: true, canExport: true, canInvite: true },
    });
    if (userId !== beneficiaryUserId) {
      if (guardianAccess === 'none') await tx.financialSpaceMember.deleteMany({ where: { spaceId, userId } });
      else await tx.financialSpaceMember.updateMany({
        where: { spaceId, userId },
        data: { role: guardianAccess === 'manage' ? 'manager' : 'advisor', canManageDocuments: guardianAccess === 'manage', canExport: false, canInvite: false },
      });
    }
  });
  await recordSpaceEvent({
    spaceId, actorId: userId, action: 'autonomy.grant', targetType: 'member', targetId: beneficiaryUserId,
    summary: `Granted autonomy over "${space.name}" to its beneficiary`,
    before: { kind: 'stewarded', ownerUserId: userId }, after: { kind: 'personal', ownerUserId: beneficiaryUserId, guardianAccess },
  });
  if (beneficiaryUserId !== userId) {
    await notifyUser({ spaceId, userId: beneficiaryUserId, kind: 'autonomy', title: `"${space.name}" is now yours`, linkPath: '/spaces' });
  }
  invalidateFinancialAccessCache();
}

export async function updateSuccessionPlan(userId: string, spaceId: string, input: {
  enabled?: boolean; minimumApprovals?: number; waitingPeriodDays?: number; instructions?: string;
  infrastructureChecklist?: string[]; successors?: Array<{ email: string; priority?: number }>;
}) {
  await requireSpaceOwner(userId, spaceId);
  const successors = (input.successors ?? []).map((item, index) => ({ email: email(item.email), priority: item.priority ?? index }));
  if (successors.some(item => !validEmail(item.email))) throw new FinancialSpaceError('Every successor needs a valid email');
  if (input.enabled && !successors.length) throw new FinancialSpaceError('Add at least one successor before enabling the plan');
  const minimumApprovals = Math.max(1, Math.min(input.minimumApprovals ?? 1, Math.max(1, successors.length)));
  const waitingPeriodDays = Math.max(1, Math.min(input.waitingPeriodDays ?? 30, 3650));
  const plan = await prisma.spaceSuccessionPlan.upsert({
    where: { spaceId },
    create: {
      spaceId, enabled: !!input.enabled, minimumApprovals, waitingPeriodDays,
      instructions: input.instructions?.trim() || null,
      infrastructureChecklist: JSON.stringify(input.infrastructureChecklist ?? []),
    },
    update: {
      enabled: !!input.enabled, minimumApprovals, waitingPeriodDays,
      instructions: input.instructions?.trim() || null,
      infrastructureChecklist: JSON.stringify(input.infrastructureChecklist ?? []),
    },
  });
  const previousEmails = new Set((await prisma.spaceSuccessor.findMany({
    where: { planId: plan.id }, select: { email: true },
  })).map(item => item.email));
  const keep = successors.map(item => item.email);
  await prisma.spaceSuccessor.deleteMany({ where: { planId: plan.id, email: { notIn: keep } } });
  for (const item of successors) {
    const target = await prisma.user.findUnique({ where: { email: item.email } });
    await prisma.spaceSuccessor.upsert({
      where: { planId_email: { planId: plan.id, email: item.email } },
      create: { planId: plan.id, email: item.email, userId: target?.id, priority: item.priority },
      update: { userId: target?.id, priority: item.priority, status: 'nominated' },
    });
    if (target) {
      await prisma.financialSpaceMember.upsert({
        where: { spaceId_userId: { spaceId, userId: target.id } },
        create: { spaceId, userId: target.id, role: 'successor' }, update: {},
      });
      if (!previousEmails.has(item.email)) {
        await notifyUser({
          spaceId, userId: target.id, kind: 'succession',
          title: 'You were nominated as a successor for a financial space', linkPath: '/spaces',
        });
      }
    }
  }
  await recordSpaceEvent({
    spaceId, actorId: userId, action: 'succession.update', targetType: 'plan', targetId: plan.id,
    summary: `${input.enabled ? 'Enabled' : 'Updated'} the succession plan (${successors.length} successor${successors.length === 1 ? '' : 's'}, quorum ${minimumApprovals}, wait ${waitingPeriodDays}d)`,
    after: { enabled: !!input.enabled, minimumApprovals, waitingPeriodDays, successors: keep },
  });
  invalidateFinancialAccessCache();
  return plan;
}

export async function hasSuccessionNomination(address: string): Promise<boolean> {
  return (await prisma.spaceSuccessor.count({
    where: { email: email(address), status: { in: ['nominated', 'accepted'] }, plan: { enabled: true } },
  })) > 0;
}

export async function acceptSuccessionNominations(userId: string, address: string): Promise<number> {
  const nominations = await prisma.spaceSuccessor.findMany({
    where: { email: email(address), status: { in: ['nominated', 'accepted'] }, plan: { enabled: true } },
    include: { plan: { select: { spaceId: true } } },
  });
  for (const nomination of nominations) {
    await prisma.spaceSuccessor.update({ where: { id: nomination.id }, data: { userId, status: 'accepted', acceptedAt: new Date() } });
    await prisma.financialSpaceMember.upsert({
      where: { spaceId_userId: { spaceId: nomination.plan.spaceId, userId } },
      create: { spaceId: nomination.plan.spaceId, userId, role: 'successor' }, update: {},
    });
  }
  if (nominations.length) invalidateFinancialAccessCache();
  return nominations.length;
}

export async function requestSuccession(userId: string, spaceId: string, reason?: string) {
  const plan = await prisma.spaceSuccessionPlan.findUnique({ where: { spaceId }, include: { successors: true } });
  if (!plan?.enabled) throw new FinancialSpaceError('Succession is not enabled for this space', 409);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const nominated = plan.successors.some(s => s.userId === userId || s.email === user?.email);
  if (!nominated) throw new FinancialSpaceError('Only a nominated successor can begin this process', 403);
  const existing = await prisma.successionRequest.findFirst({ where: { planId: plan.id, status: { in: ['pending', 'approved'] } } });
  if (existing) throw new FinancialSpaceError('A succession request is already pending', 409);
  const request = await prisma.successionRequest.create({
    data: { planId: plan.id, requestedById: userId, reason: reason?.trim() || null, executeAfter: new Date(Date.now() + plan.waitingPeriodDays * 86_400_000) },
  });
  await recordSpaceEvent({
    spaceId, actorId: userId, action: 'succession.request', targetType: 'request', targetId: request.id,
    summary: 'A successor started the emergency succession process',
    after: { executeAfter: request.executeAfter }, reason: reason?.trim() || undefined,
  });
  // The owner must hear about this immediately — succession can only proceed
  // through quorum plus the waiting period, and the owner can cancel it.
  await notifySpaceMembers(spaceId, {
    kind: 'succession', title: 'Emergency succession was requested for a financial space', linkPath: '/spaces',
  }, { excludeUserId: userId });
  return request;
}

export async function approveSuccession(userId: string, requestId: string, decision: 'approve' | 'reject' = 'approve') {
  const request = await prisma.successionRequest.findUnique({
    where: { id: requestId }, include: { plan: { include: { successors: true } } },
  });
  if (!request || !['pending', 'approved'].includes(request.status)) throw new FinancialSpaceError('Pending request not found', 404);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!request.plan.successors.some(s => s.userId === userId || s.email === user?.email)) {
    throw new FinancialSpaceError('Only a nominated successor can approve this request', 403);
  }
  await prisma.successionApproval.upsert({
    where: { requestId_userId: { requestId, userId } }, create: { requestId, userId, decision }, update: { decision, decidedAt: new Date() },
  });
  const approvals = await prisma.successionApproval.count({ where: { requestId, decision: 'approve' } });
  const rejected = await prisma.successionApproval.count({ where: { requestId, decision: 'reject' } });
  const nextStatus = rejected ? 'rejected' : approvals >= request.plan.minimumApprovals ? 'approved' : 'pending';
  await prisma.successionRequest.update({ where: { id: requestId }, data: { status: nextStatus } });
  await recordSpaceEvent({
    spaceId: request.plan.spaceId, actorId: userId, action: decision === 'approve' ? 'succession.approve' : 'succession.reject',
    targetType: 'request', targetId: requestId,
    summary: `A successor ${decision === 'approve' ? 'approved' : 'rejected'} the succession request`,
    after: { approvals, requiredApprovals: request.plan.minimumApprovals, status: nextStatus },
  });
  if (nextStatus !== 'pending') {
    await notifySpaceMembers(request.plan.spaceId, {
      kind: 'succession',
      title: nextStatus === 'approved'
        ? 'A succession request reached its approval quorum'
        : 'A succession request was rejected',
      linkPath: '/spaces',
    }, { excludeUserId: userId });
  }
}

export async function executeSuccession(userId: string, requestId: string) {
  const request = await prisma.successionRequest.findUnique({
    where: { id: requestId }, include: { approvals: true, plan: { include: { successors: true } } },
  });
  if (!request || request.status !== 'approved') throw new FinancialSpaceError('This request has not reached approval quorum', 409);
  if (request.executeAfter > new Date()) throw new FinancialSpaceError(`The waiting period ends ${request.executeAfter.toISOString()}`, 409);
  const successor = request.plan.successors.find(s => s.userId === userId);
  if (!successor) throw new FinancialSpaceError('Only the approved successor can execute the transfer', 403);
  if (request.approvals.filter(a => a.decision === 'approve').length < request.plan.minimumApprovals) throw new FinancialSpaceError('Approval quorum is no longer satisfied', 409);
  await prisma.$transaction(async tx => {
    await tx.financialSpaceMember.updateMany({ where: { spaceId: request.plan.spaceId, role: 'owner' }, data: { role: 'successor', canInvite: false } });
    await tx.financialSpaceMember.upsert({
      where: { spaceId_userId: { spaceId: request.plan.spaceId, userId } },
      create: { spaceId: request.plan.spaceId, userId, role: 'owner', canManageDocuments: true, canExport: true, canInvite: true },
      update: { role: 'owner', canManageDocuments: true, canExport: true, canInvite: true },
    });
    await tx.successionRequest.update({ where: { id: requestId }, data: { status: 'executed' } });
    await tx.financialSpace.update({ where: { id: request.plan.spaceId }, data: { status: 'active' } });
  });
  await recordSpaceEvent({
    spaceId: request.plan.spaceId, actorId: userId, action: 'succession.execute', targetType: 'request', targetId: requestId,
    summary: 'Succession executed: ownership transferred to the approved successor',
    after: { newOwnerUserId: userId },
  });
  await notifySpaceMembers(request.plan.spaceId, {
    kind: 'succession', title: 'Ownership of a financial space transferred through succession', linkPath: '/spaces',
  }, { excludeUserId: userId });
  invalidateFinancialAccessCache();
}

/** The space owner (or the requesting successor) can cancel an in-flight
 * succession request at any point before execution. */
export async function cancelSuccession(userId: string, requestId: string) {
  const request = await prisma.successionRequest.findUnique({
    where: { id: requestId }, include: { plan: { select: { spaceId: true } } },
  });
  if (!request || !['pending', 'approved'].includes(request.status)) throw new FinancialSpaceError('Pending request not found', 404);
  const actor = await membership(userId, request.plan.spaceId);
  const isOwner = actor?.role === 'owner';
  if (!isOwner && request.requestedById !== userId) {
    throw new FinancialSpaceError('Only the space owner or the requesting successor can cancel this request', 403);
  }
  await prisma.successionRequest.update({ where: { id: requestId }, data: { status: 'canceled' } });
  await recordSpaceEvent({
    spaceId: request.plan.spaceId, actorId: userId, action: 'succession.cancel', targetType: 'request', targetId: requestId,
    summary: isOwner ? 'The owner canceled the succession request' : 'The requesting successor withdrew the succession request',
    before: { status: request.status },
  });
  await notifySpaceMembers(request.plan.spaceId, {
    kind: 'succession', title: 'A succession request was canceled', linkPath: '/spaces',
  }, { excludeUserId: userId });
}
