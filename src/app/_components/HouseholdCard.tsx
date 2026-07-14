'use client';

import { useState } from 'react';
import { Btn, ChipBtn, Pill, fmtDate } from './atoms';
import type { HouseholdView } from '@/lib/household';

export default function HouseholdCard({ initial }: { initial: HouseholdView | null }) {
  const [household, setHousehold] = useState(initial);
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'owner'>('member');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!household) return <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>No household found.</div>;
  const isOwner = household.viewerRole === 'owner';

  async function call(url: string, method: string, body?: unknown, success = 'Saved') {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? 'Household update failed');
      if (result.household) {
        setHousehold(result.household);
        setName(result.household.name);
      }
      setMessage(success);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Household update failed');
      return false;
    } finally { setBusy(false); }
  }

  async function invite() {
    if (!email.trim()) return;
    const ok = await call('/api/household/invites', 'POST', { email: email.trim(), role }, `Invitation ready for ${email.trim()}`);
    if (ok) setEmail('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input aria-label="Household name" value={name} onChange={event => setName(event.target.value)} disabled={!isOwner}
               style={{ flex: 1, height: 36, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-elevated)', color: 'var(--fg)', fontSize: 13 }} />
        {isOwner && <Btn variant="primary" size="sm" disabled={busy || !name.trim() || name === household.name} onClick={() => call('/api/household', 'PATCH', { name })}>Rename</Btn>}
      </div>

      <div>
        <div style={captionStyle}>Members ({household.members.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {household.members.map(member => (
            <div key={member.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px auto', gap: 8, alignItems: 'center', minHeight: 34 }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13, color: 'var(--fg-strong)' }}>{member.name || member.email}{member.isCurrent ? ' (you)' : ''}</span>
                {member.name && <span style={{ display: 'block', fontSize: 10, color: 'var(--fg-subtle)' }}>{member.email}</span>}
              </span>
              {isOwner && !member.isCurrent ? (
                <select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy} onChange={event => call(`/api/household/members/${member.id}`, 'PATCH', { role: event.target.value })} style={{ height: 30, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-elevated)', color: 'var(--fg)', fontSize: 11 }}><option value="member">Member</option><option value="owner">Owner</option></select>
              ) : <Pill tone={member.role === 'owner' ? 'success' : 'ghost'} style={{ justifySelf: 'start', fontSize: 9 }}>{member.role}</Pill>}
              {isOwner && !member.isCurrent ? <ChipBtn tone="danger" disabled={busy} onClick={() => call(`/api/household/members/${member.id}`, 'DELETE', undefined, `${member.email} removed`)}>Remove</ChipBtn> : <span />}
            </div>
          ))}
        </div>
      </div>

      {isOwner && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={captionStyle}>Invite someone</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px auto', gap: 7 }}>
            <input aria-label="Invite email" type="email" placeholder="person@example.com" value={email} onChange={event => setEmail(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') invite(); }} style={{ height: 34, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-elevated)', color: 'var(--fg)', fontSize: 12 }} />
            <select aria-label="Invitation role" value={role} onChange={event => setRole(event.target.value as 'member' | 'owner')} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-elevated)', color: 'var(--fg)', fontSize: 11 }}><option value="member">Member</option><option value="owner">Owner</option></select>
            <Btn variant="primary" size="sm" disabled={busy || !email.trim()} onClick={invite}>Invite</Btn>
          </div>
          <div style={{ marginTop: 7, fontSize: 10, color: 'var(--fg-subtle)', lineHeight: 1.45 }}>
            Invitations expire after 14 days. Astroledger does not send email yet—share this app's address with them. They must sign in with the exact invited Google email. If <code>ALLOWED_EMAILS</code> is configured, add them there too.
          </div>
        </div>
      )}

      {isOwner && household.invites.length > 0 && (
        <div>
          <div style={captionStyle}>Pending ({household.invites.length})</div>
          {household.invites.map(invite => (
            <div key={invite.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 8, alignItems: 'center', minHeight: 32, fontSize: 12 }}>
              <span style={{ color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{invite.email}</span>
              <span style={{ color: 'var(--fg-subtle)', fontSize: 10 }}>{invite.role} · expires {fmtDate(invite.expiresAt)}</span>
              <ChipBtn disabled={busy} onClick={() => call(`/api/household/invites/${invite.id}`, 'DELETE', undefined, 'Invitation revoked')}>Revoke</ChipBtn>
            </div>
          ))}
        </div>
      )}

      {(message || error) && <div role={error ? 'alert' : 'status'} style={{ fontSize: 11, color: error ? 'var(--error)' : 'var(--success)' }}>{error ?? message}</div>}
      <div style={{ fontSize: 11, color: 'var(--fg-subtle)', lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        Everyone in this self-hosted household shares the same ledger, plans, imports, and reports. Owners manage membership; members can use the financial workspace but cannot invite or remove people.
      </div>
    </div>
  );
}

const captionStyle: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 6 };
