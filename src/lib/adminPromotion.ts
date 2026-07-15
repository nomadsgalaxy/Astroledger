// Instance-admin resolution, checked on every session.
//
// Rules, in order:
//   1. A user already flagged isAdmin stays admin.
//   2. Any email listed in ADMIN_EMAILS (comma-separated, case-insensitive)
//      is promoted on sign-in and persisted.
//   3. If the instance has NO admin at all — fresh installs before the first
//      promotion, or databases created before the isAdmin column existed —
//      the earliest-created user is promoted. The first person who ever
//      signed in is the operator.
import { prisma } from './prisma';

export function adminEmailAllowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

export async function ensureAdminStatus(userId: string, email: string | null | undefined, currentIsAdmin: boolean): Promise<boolean> {
  if (currentIsAdmin) return true;

  if (email && adminEmailAllowlist().includes(email.toLowerCase())) {
    await prisma.user.update({ where: { id: userId }, data: { isAdmin: true } });
    return true;
  }

  const admins = await prisma.user.count({ where: { isAdmin: true } });
  if (admins === 0) {
    const oldest = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (oldest?.id === userId) {
      await prisma.user.update({ where: { id: userId }, data: { isAdmin: true } });
      return true;
    }
  }
  return false;
}
