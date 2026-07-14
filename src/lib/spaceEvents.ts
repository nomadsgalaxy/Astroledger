// Space audit events + in-app notifications.
//
// The request-scoped Prisma guard deliberately blocks the model-write API for
// SpaceAuditEvent and SpaceNotification: audit rows may belong to a space that
// is not the actor's active one (e.g. a successor executing a transfer) and
// notifications routinely target OTHER users. These parameterized inserts are
// the single privileged write path, called only after the surrounding service
// has already authorized the action. Every new call site is a security review
// point, same as any other raw SQL.
//
// ponytail: writes are best-effort (log loudly, never fail the action). If a
// compliance need ever demands "no audit row, no action", move the insert into
// the caller's transaction instead of adding retries here.
import { randomUUID } from 'node:crypto';
import { prisma } from './prisma';

const SNAPSHOT_LIMIT = 4_000; // keep before/after JSON bounded

export type SpaceAuditInput = {
  spaceId: string;
  actorId: string; // user id, or "system" for cron/bearer surfaces
  action: string; // e.g. "member.invite", "grant.set", "succession.execute"
  targetType?: string;
  targetId?: string;
  summary: string; // human-readable one-liner, no secrets
  before?: unknown; // JSON-serializable snapshot of changed fields, no secrets
  after?: unknown;
  reason?: string;
};

function snapshot(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try { return JSON.stringify(value).slice(0, SNAPSHOT_LIMIT); } catch { return null; }
}

export async function recordSpaceEvent(event: SpaceAuditInput): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO SpaceAuditEvent (id, spaceId, at, actorId, action, targetType, targetId, summary, before, after, reason)
      VALUES (${randomUUID()}, ${event.spaceId}, ${new Date()}, ${event.actorId}, ${event.action},
              ${event.targetType ?? null}, ${event.targetId ?? null}, ${event.summary.slice(0, 500)},
              ${snapshot(event.before)}, ${snapshot(event.after)}, ${event.reason?.slice(0, 500) ?? null})
    `;
  } catch (error) {
    console.error('spaceEvents: audit write failed', event.action, error);
  }
}

export type SpaceNotificationInput = {
  spaceId: string;
  userId: string; // recipient
  kind: string; // invite | permission | grant | export | succession | autonomy | ownership | document
  title: string;
  body?: string;
  linkPath?: string; // in-app destination, e.g. "/spaces"
};

export async function notifyUser(input: SpaceNotificationInput): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO SpaceNotification (id, spaceId, userId, at, kind, title, body, linkPath)
      VALUES (${randomUUID()}, ${input.spaceId}, ${input.userId}, ${new Date()}, ${input.kind},
              ${input.title.slice(0, 300)}, ${input.body?.slice(0, 1000) ?? null}, ${input.linkPath ?? null})
    `;
  } catch (error) {
    console.error('spaceEvents: notification write failed', input.kind, error);
  }
}

/** Notify every member of a space (optionally excluding the actor and/or
 * restricting to specific roles, e.g. owners for succession requests). */
export async function notifySpaceMembers(
  spaceId: string,
  notification: Omit<SpaceNotificationInput, 'spaceId' | 'userId'>,
  options: { excludeUserId?: string; roles?: string[] } = {},
): Promise<void> {
  try {
    const members = await prisma.financialSpaceMember.findMany({
      where: { spaceId, ...(options.roles ? { role: { in: options.roles } } : {}) },
      select: { userId: true },
    });
    for (const member of members) {
      if (member.userId === options.excludeUserId) continue;
      await notifyUser({ ...notification, spaceId, userId: member.userId });
    }
  } catch (error) {
    console.error('spaceEvents: member notification failed', notification.kind, error);
  }
}
