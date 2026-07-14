// Audit trail for agent-surface tool calls (/api/mcp, /api/chat). Best-effort:
// a logging failure must never break the actual request, so every write is
// wrapped + swallowed.
import { createHash } from 'node:crypto';
import { prisma } from './prisma';

export type AuditEntry = {
  surface: 'mcp' | 'chat';
  actor: string;
  tool: string;
  isWrite: boolean;
  ok: boolean;
  error?: string | null;
};

export async function recordAudit(e: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { surface: e.surface, actor: e.actor, tool: e.tool, isWrite: e.isWrite, ok: e.ok, error: e.error?.slice(0, 300) ?? null },
    });
  } catch { /* audit is best-effort */ }
}

// Stable, non-reversible short label for a bearer token so the audit log can
// attribute activity to a credential without storing the secret.
export function tokenActor(token: string): string {
  return 'token:' + createHash('sha256').update(token).digest('hex').slice(0, 8);
}
