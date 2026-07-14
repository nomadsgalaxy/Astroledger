import type { PrismaClient } from '@prisma/client';

export const ACTIVE_SPACE_COOKIE = 'astroledger.active-space';

export type AccessLevel = 'none' | 'summary' | 'view' | 'manage' | 'owner';
export type SpaceRole = 'owner' | 'manager' | 'contributor' | 'viewer' | 'guardian' | 'beneficiary' | 'advisor' | 'successor';

export type RequestAccess = {
  userId: string;
  email: string;
  activeSpaceId: string;
  activeSpaceName: string;
  activeSpaceKind: string;
  role: SpaceRole;
  spaceIds: string[];
  summaryAccountIds: string[];
  viewAccountIds: string[];
  manageAccountIds: string[];
  ownerAccountIds: string[];
  documentViewAccountIds: string[];
  documentManageAccountIds: string[];
  exportAccountIds: string[];
  shareAccountIds: string[];
  canCreate: boolean;
  canAdminSpace: boolean;
  canViewDocuments: boolean;
  canManageDocuments: boolean;
  canExportSpace: boolean;
  canInvite: boolean;
};

const LEVEL: Record<AccessLevel, number> = { none: 0, summary: 1, view: 2, manage: 3, owner: 4 };
const SYSTEM_SPACE_MODELS = new Set([
  'AuditLog', 'BillOccurrence', 'Budget', 'Category', 'Envelope', 'Forecast', 'Goal',
  'MileageLog', 'NetWorthSnapshot', 'Order', 'Plan', 'Recommendation', 'Rule',
  'Scenario', 'Schedule', 'SpendingAlert', 'Subscription', 'Tag', 'TaxBucket',
  'SharedExpense', 'AllowanceRule', 'AllowancePayout', 'ChoreTask',
]);
const ACCOUNT_MODELS = new Set(['Transaction', 'Holding', 'InvestmentTxn']);
const CHILD_MODELS: Record<string, { relation: string; parent: string }> = {
  ForecastPoint: { relation: 'forecast', parent: 'Forecast' },
  PlanLine: { relation: 'plan', parent: 'Plan' },
  ScenarioAdjustment: { relation: 'scenario', parent: 'Scenario' },
  ExpenseShare: { relation: 'expense', parent: 'SharedExpense' },
};

function roleLevel(role: string): AccessLevel {
  if (role === 'owner') return 'owner';
  if (role === 'manager' || role === 'guardian' || role === 'contributor') return 'manage';
  if (role === 'successor') return 'none';
  return 'view';
}

function minLevel(a: AccessLevel, b: AccessLevel): AccessLevel {
  return (LEVEL[a] <= LEVEL[b] ? a : b);
}

function safeRole(role: string): SpaceRole {
  const known = ['owner', 'manager', 'contributor', 'viewer', 'guardian', 'beneficiary', 'advisor', 'successor'];
  return (known.includes(role) ? role : 'viewer') as SpaceRole;
}

/**
 * Create durable personal/shared spaces for a user. This is deliberately
 * idempotent and may run on sign-in as well as during migration self-healing.
 */
export async function ensureUserFinancialSpaces(client: PrismaClient | any, userId: string): Promise<void> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
  if (!user) return;
  const householdMemberships = await client.householdMember.findMany({
    where: { userId },
    include: { household: { select: { id: true, name: true } } },
  });

  const personalId = `space_personal_${userId}`;
  await client.financialSpace.upsert({
    where: { id: personalId },
    update: { beneficiaryUserId: userId },
    create: {
      id: personalId,
      name: `${(user.name || user.email).trim()}'s Finances`,
      kind: 'personal',
      beneficiaryUserId: userId,
      createdById: userId,
    },
  });
  await client.financialSpaceMember.upsert({
    where: { spaceId_userId: { spaceId: personalId, userId } },
    update: { role: 'owner', canManageDocuments: true, canExport: true, canInvite: true },
    create: {
      spaceId: personalId,
      userId,
      role: 'owner',
      canManageDocuments: true,
      canExport: true,
      canInvite: true,
    },
  });

  for (const membership of householdMemberships) {
    const spaceId = `space_hh_${membership.householdId}`;
    await client.financialSpace.upsert({
      where: { id: spaceId },
      update: { name: `${membership.household.name} Finances`, householdId: membership.householdId },
      create: {
        id: spaceId,
        name: `${membership.household.name} Finances`,
        kind: 'household',
        householdId: membership.householdId,
        createdById: userId,
      },
    });
    const role = membership.role === 'owner' ? 'owner' : 'manager';
    await client.financialSpaceMember.upsert({
      where: { spaceId_userId: { spaceId, userId } },
      update: {},
      create: {
        spaceId,
        userId,
        role,
        canManageDocuments: true,
        canExport: true,
        canInvite: role === 'owner',
      },
    });
  }
}

export async function resolveRequestAccess(
  client: PrismaClient | any,
  sessionToken: string,
  requestedSpaceId?: string | null,
): Promise<RequestAccess | null> {
  const session = await client.session.findUnique({
    where: { sessionToken },
    select: { expires: true, user: { select: { id: true, email: true } } },
  });
  if (!session || session.expires <= new Date()) return null;
  const userId = session.user.id;
  await ensureUserFinancialSpaces(client, userId);

  const memberships = await client.financialSpaceMember.findMany({
    where: { userId, space: { status: { not: 'archived' } } },
    include: { space: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!memberships.length) return null;
  const selected = memberships.find((m: any) => m.spaceId === requestedSpaceId)
    ?? memberships.find((m: any) => m.space.kind === 'household')
    ?? memberships.find((m: any) => m.space.kind === 'personal')
    ?? memberships[0];
  const role = safeRole(selected.role);
  const memberMax = roleLevel(role);
  const canCreate = LEVEL[memberMax] >= LEVEL.manage;

  const owned = await client.bankAccount.findMany({
    where: { ownerSpaceId: selected.spaceId },
    select: { id: true },
  });
  const now = new Date();
  const grantTargets: any[] = [{ granteeSpaceId: selected.spaceId }];
  // Direct delegations follow a person into their private workspace. This
  // gives advisors/parents one predictable place for "accounts shared to me".
  if (selected.space.kind === 'personal') grantTargets.push({ granteeUserId: userId });
  const grants = await client.accountGrant.findMany({
    where: { AND: [{ OR: grantTargets }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] },
  });

  const levels = new Map<string, AccessLevel>();
  const documentView = new Set<string>();
  const documentManage = new Set<string>();
  const exportIds = new Set<string>();
  const shareIds = new Set<string>();
  for (const account of owned) {
    levels.set(account.id, memberMax);
    if (selected.canManageDocuments || role === 'owner') {
      documentView.add(account.id);
      documentManage.add(account.id);
    }
    if (selected.canExport || role === 'owner') exportIds.add(account.id);
    if (role === 'owner') shareIds.add(account.id);
  }
  for (const grant of grants) {
    const raw = (grant.accessLevel in LEVEL ? grant.accessLevel : 'view') as AccessLevel;
    const effective = grant.granteeSpaceId ? minLevel(raw, memberMax) : raw;
    const previous = levels.get(grant.accountId) ?? 'none';
    if (LEVEL[effective] > LEVEL[previous]) levels.set(grant.accountId, effective);
    if (grant.documentAccess === 'view' || grant.documentAccess === 'manage') documentView.add(grant.accountId);
    if (grant.documentAccess === 'manage') documentManage.add(grant.accountId);
    if (grant.canExport) exportIds.add(grant.accountId);
    if (grant.canShare) shareIds.add(grant.accountId);
  }

  const idsAt = (minimum: AccessLevel) => [...levels.entries()]
    .filter(([, level]) => LEVEL[level] >= LEVEL[minimum]).map(([id]) => id);
  return {
    userId,
    email: session.user.email,
    activeSpaceId: selected.spaceId,
    activeSpaceName: selected.space.name,
    activeSpaceKind: selected.space.kind,
    role,
    spaceIds: memberships.map((m: any) => m.spaceId),
    summaryAccountIds: idsAt('summary'),
    viewAccountIds: idsAt('view'),
    manageAccountIds: idsAt('manage'),
    ownerAccountIds: idsAt('owner'),
    documentViewAccountIds: [...documentView],
    documentManageAccountIds: [...documentManage],
    exportAccountIds: [...exportIds],
    shareAccountIds: [...shareIds],
    canCreate,
    canAdminSpace: role === 'owner',
    canViewDocuments: selected.canManageDocuments || ['owner', 'manager', 'guardian'].includes(role),
    canManageDocuments: selected.canManageDocuments || role === 'owner',
    canExportSpace: selected.canExport || role === 'owner',
    canInvite: selected.canInvite || role === 'owner',
  };
}

/** Capability context for bearer-authenticated automation and cron jobs that
 * have no browser cookie. They operate on the oldest shared household space,
 * never across private spaces. */
export async function resolveSystemFinancialAccess(client: PrismaClient | any): Promise<RequestAccess | null> {
  const space = await client.financialSpace.findFirst({
    where: { kind: 'household', status: { not: 'archived' } },
    orderBy: { createdAt: 'asc' },
  }) ?? await client.financialSpace.findFirst({
    where: { status: { not: 'archived' } }, orderBy: { createdAt: 'asc' },
  });
  if (!space) return null;
  const owned = await client.bankAccount.findMany({ where: { ownerSpaceId: space.id }, select: { id: true } });
  const grants = await client.accountGrant.findMany({
    where: { granteeSpaceId: space.id, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  });
  const levels = new Map<string, AccessLevel>(owned.map((account: { id: string }): [string, AccessLevel] => [account.id, 'owner']));
  const documentView = new Set<string>(owned.map((account: { id: string }) => account.id));
  const documentManage = new Set<string>(documentView);
  const exportIds = new Set<string>(documentView);
  const shareIds = new Set<string>(documentView);
  for (const grant of grants) {
    const level = (grant.accessLevel in LEVEL ? grant.accessLevel : 'view') as AccessLevel;
    const current = levels.get(grant.accountId) ?? 'none';
    if (LEVEL[level] > LEVEL[current]) levels.set(grant.accountId, level);
    if (grant.documentAccess === 'view' || grant.documentAccess === 'manage') documentView.add(grant.accountId);
    if (grant.documentAccess === 'manage') documentManage.add(grant.accountId);
    if (grant.canExport) exportIds.add(grant.accountId);
    if (grant.canShare) shareIds.add(grant.accountId);
  }
  const idsAt = (minimum: AccessLevel) => [...levels.entries()].filter(([, value]) => LEVEL[value] >= LEVEL[minimum]).map(([id]) => id);
  return {
    userId: 'system', email: '', activeSpaceId: space.id, activeSpaceName: space.name,
    activeSpaceKind: space.kind, role: 'owner', spaceIds: [space.id],
    summaryAccountIds: idsAt('summary'), viewAccountIds: idsAt('view'), manageAccountIds: idsAt('manage'), ownerAccountIds: idsAt('owner'),
    documentViewAccountIds: [...documentView], documentManageAccountIds: [...documentManage],
    exportAccountIds: [...exportIds], shareAccountIds: [...shareIds],
    canCreate: true, canAdminSpace: true, canViewDocuments: true, canManageDocuments: true,
    canExportSpace: true, canInvite: false,
  };
}

export class FinancialAccessError extends Error {
  constructor(message = 'You do not have permission to do that', public status = 403) { super(message); }
}

export function hasAccountAccess(access: RequestAccess, accountId: string, minimum: AccessLevel): boolean {
  const pool = minimum === 'owner' ? access.ownerAccountIds
    : minimum === 'manage' ? access.manageAccountIds
      : minimum === 'view' ? access.viewAccountIds
        : access.summaryAccountIds;
  return pool.includes(accountId);
}

export function requireAccountAccess(access: RequestAccess | null, accountId: string, minimum: AccessLevel): void {
  if (!access || !hasAccountAccess(access, accountId, minimum)) throw new FinancialAccessError();
}

function andWhere(existing: any, scope: any): any {
  if (!existing || Object.keys(existing).length === 0) return scope;
  // Keeping unique selectors at the top lets Prisma accept extended unique
  // filters while still enforcing our ownership condition.
  return { ...existing, AND: [...(Array.isArray(existing.AND) ? existing.AND : existing.AND ? [existing.AND] : []), scope] };
}

function accountScope(ids: string[]) { return { accountId: { in: ids } }; }

function readScope(model: string, access: RequestAccess): any | null {
  if (model === 'Category' || model === 'Tag') return { OR: [{ spaceId: access.activeSpaceId }, { spaceId: null }] };
  // The audit trail is admin-only within the active space; notifications are
  // personal and follow the recipient across whichever space is active.
  if (model === 'SpaceAuditEvent') return access.canAdminSpace ? { spaceId: access.activeSpaceId } : { id: { in: [] } };
  if (model === 'SpaceNotification') return { userId: access.userId };
  if (model === 'BankAccount') return { id: { in: access.summaryAccountIds } };
  if (model === 'Institution') return { ownerSpaceId: access.activeSpaceId };
  if (ACCOUNT_MODELS.has(model)) return accountScope(access.viewAccountIds);
  if (model === 'Receipt') return { transaction: accountScope(access.documentViewAccountIds) };
  if (model === 'FinancialDocument') {
    const clauses: any[] = [];
    if (access.canViewDocuments) clauses.push({ spaceId: access.activeSpaceId });
    if (access.documentViewAccountIds.length) clauses.push({ accountId: { in: access.documentViewAccountIds } });
    return clauses.length ? { OR: clauses } : { id: { in: [] } };
  }
  if (SYSTEM_SPACE_MODELS.has(model)) return { spaceId: access.activeSpaceId };
  if (CHILD_MODELS[model]) return { [CHILD_MODELS[model].relation]: { spaceId: access.activeSpaceId } };
  return null;
}

function writeScope(model: string, access: RequestAccess, operation: string): any | null {
  // Append-only: no session may update or delete audit rows. Notifications
  // may only be touched (mark read / dismiss) by their recipient.
  if (model === 'SpaceAuditEvent') return { id: { in: [] } };
  if (model === 'SpaceNotification') return { userId: access.userId };
  // A dependent without manage rights may still update their OWN chores
  // (mark done); managers get normal space-wide writes.
  if (model === 'ChoreTask' && !access.canCreate) {
    return operation === 'update' || operation === 'updateMany'
      ? { spaceId: access.activeSpaceId, assigneeUserId: access.userId }
      : { id: { in: [] } };
  }
  if (model === 'BankAccount') {
    const ids = operation === 'delete' || operation === 'deleteMany' ? access.ownerAccountIds : access.manageAccountIds;
    return { id: { in: ids } };
  }
  if (model === 'Institution') return access.canCreate ? { ownerSpaceId: access.activeSpaceId } : { id: { in: [] } };
  if (ACCOUNT_MODELS.has(model)) return accountScope(access.manageAccountIds);
  if (model === 'Receipt') return { transaction: accountScope(access.documentManageAccountIds) };
  if (model === 'FinancialDocument') {
    const clauses: any[] = [];
    if (access.canManageDocuments) clauses.push({ spaceId: access.activeSpaceId });
    if (access.documentManageAccountIds.length) clauses.push({ accountId: { in: access.documentManageAccountIds } });
    return clauses.length ? { OR: clauses } : { id: { in: [] } };
  }
  if (SYSTEM_SPACE_MODELS.has(model)) return access.canCreate ? { spaceId: access.activeSpaceId } : { id: { in: [] } };
  if (CHILD_MODELS[model]) return access.canCreate
    ? { [CHILD_MODELS[model].relation]: { spaceId: access.activeSpaceId } }
    : { id: { in: [] } };
  return null;
}

function injectCreate(model: string, data: any, access: RequestAccess): any {
  if (!data) return data;
  // These are written only through the privileged helpers in spaceEvents.ts
  // (parameterized inserts after the calling service authorized the action).
  // Notifications routinely target OTHER users and audit rows may belong to a
  // space that is not the actor's active one, so the model API stays closed.
  if (model === 'SpaceAuditEvent' || model === 'SpaceNotification') throw new FinancialAccessError();
  // Shares must be created nested under their (space-scoped) SharedExpense so
  // a share can never be forged onto another space's expense.
  if (model === 'ExpenseShare') throw new FinancialAccessError();
  if (model === 'BankAccount' || model === 'Institution') {
    if (!access.canCreate) throw new FinancialAccessError();
    return { ...data, ownerSpaceId: access.activeSpaceId };
  }
  if (SYSTEM_SPACE_MODELS.has(model)) {
    if (!access.canCreate) throw new FinancialAccessError();
    return { ...data, spaceId: access.activeSpaceId };
  }
  if (ACCOUNT_MODELS.has(model)) {
    if (!data.accountId || !access.manageAccountIds.includes(data.accountId)) throw new FinancialAccessError();
  }
  if (model === 'FinancialDocument') {
    if (!access.canManageDocuments && (!data.accountId || !access.documentManageAccountIds.includes(data.accountId))) {
      throw new FinancialAccessError('Document management permission is required');
    }
    return { ...data, spaceId: access.activeSpaceId, uploadedById: access.userId };
  }
  return data;
}

function scopeNestedReads(model: string, args: any, access: RequestAccess): any {
  if (!args?.include) return args;
  const include = { ...args.include };
  const safeInstitution = { select: {
    id: true, name: true, source: true, createdAt: true, lastSyncedAt: true,
    lastSyncStatus: true, lastSyncError: true, ownerSpaceId: true,
  } };
  if (model === 'BankAccount') {
    if (include.institution === true) include.institution = safeInstitution;
    for (const relation of ['transactions', 'holdings', 'investmentTxns']) {
      if (!include[relation]) continue;
      const current = include[relation] === true ? {} : include[relation];
      include[relation] = { ...current, where: andWhere(current.where, { accountId: { in: access.viewAccountIds } }) };
    }
    if (include.documents) {
      const current = include.documents === true ? {} : include.documents;
      include.documents = { ...current, where: andWhere(current.where, { accountId: { in: access.documentViewAccountIds } }) };
    }
  }
  if ((model === 'Transaction' || model === 'Holding' || model === 'InvestmentTxn') && include.account) {
    const account = include.account === true ? {} : { ...include.account };
    if (account.include?.institution === true) {
      account.include = { ...account.include, institution: safeInstitution };
    }
    include.account = account;
  }
  if (model === 'Transaction' && include.receipts) {
    const current = include.receipts === true ? {} : include.receipts;
    include.receipts = { ...current, where: andWhere(current.where, { transaction: { accountId: { in: access.documentViewAccountIds } } }) };
  }
  if (model === 'Subscription' && include.transactions) {
    const current = include.transactions === true ? {} : include.transactions;
    include.transactions = { ...current, where: andWhere(current.where, { accountId: { in: access.viewAccountIds } }) };
  }
  if (model === 'Institution' && include.accounts) {
    const current = include.accounts === true ? {} : include.accounts;
    include.accounts = { ...current, where: andWhere(current.where, { id: { in: access.summaryAccountIds } }) };
  }
  return { ...args, include };
}

/** Apply fail-closed request scoping to all sensitive Prisma operations. */
export async function applyFinancialScope(
  model: string,
  operation: string,
  incoming: any,
  access: RequestAccess,
): Promise<any> {
  let args = { ...(incoming ?? {}) };
  const reads = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
  const writes = new Set(['update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany']);
  if (reads.has(operation)) {
    const scope = readScope(model, access);
    if (scope) args.where = andWhere(args.where, scope);
    return scopeNestedReads(model, args, access);
  }
  if (operation === 'create') {
    args.data = injectCreate(model, args.data, access);
    return args;
  }
  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const rows = Array.isArray(args.data) ? args.data : [args.data];
    args.data = rows.map((row: any) => injectCreate(model, row, access));
    return args;
  }
  if (operation === 'upsert') {
    const scope = writeScope(model, access, operation);
    if (scope) args.where = andWhere(args.where, scope);
    args.create = injectCreate(model, args.create, access);
    // Ownership columns are immutable through ordinary upserts.
    if (args.update) {
      const { spaceId: _space, ownerSpaceId: _owner, ...safe } = args.update;
      args.update = safe;
    }
    return args;
  }
  if (writes.has(operation)) {
    const scope = writeScope(model, access, operation);
    if (scope) args.where = andWhere(args.where, scope);
    if (args.data) {
      if (model === 'SpaceNotification') {
        // A recipient may only flip read state; every other column is frozen.
        args.data = 'readAt' in args.data ? { readAt: args.data.readAt } : {};
      } else if (model === 'ChoreTask' && !access.canCreate) {
        // A dependent can only mark completion; reward/status semantics are
        // enforced by the chore service, money movement by manager approval.
        const allowed: any = {};
        if ('status' in args.data) allowed.status = args.data.status;
        if ('completedAt' in args.data) allowed.completedAt = args.data.completedAt;
        args.data = allowed;
      } else {
        const { spaceId: _space, ownerSpaceId: _owner, ...safe } = args.data;
        args.data = safe;
      }
    }
    return args;
  }
  return args;
}
