'use client';

// Settings › Household & spaces — the management hub. One card per space the
// user belongs to, with controls scaled to their role in THAT space (the
// /api/financial-spaces actions validate ownership per explicit spaceId, so
// nothing here depends on which space is currently active). Day-to-day money
// workflows (sharing, splits, allowances, documents) stay on /spaces.
import { FormEvent, useState } from 'react';
import { MEMBER_PRESETS, ROLE_HINTS } from '@/lib/memberPresets';

type SettingsView = { spaces: any[] };

const input: React.CSSProperties = {
  height: 34, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg)',
  color: 'var(--fg-strong)', padding: '0 10px', fontFamily: 'var(--font-body)', fontSize: 12,
};
const button: React.CSSProperties = {
  minHeight: 34, border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)', background: 'var(--accent)',
  color: 'white', padding: '0 12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12,
};
const subtleButton: React.CSSProperties = { ...button, background: 'transparent', color: 'var(--fg-strong)', borderColor: 'var(--border)' };
const dangerLink: React.CSSProperties = { border: 0, background: 'none', color: 'var(--negative)', cursor: 'pointer', fontSize: 11 };
const caption: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-subtle)',
};

const KIND_ACCENT: Record<string, string> = {
  personal: 'var(--accent)',
  household: 'var(--positive, #3fa66a)',
  stewarded: 'var(--orange-copper, #c47a3d)',
};
const KIND_LABEL: Record<string, string> = {
  personal: 'Private', household: 'Household', stewarded: 'Stewarded',
};

function SpaceCard({ space, busy, onAction }: {
  space: any; busy: boolean;
  onAction: (payload: Record<string, unknown>, label: string) => Promise<boolean>;
}) {
  const [invite, setInvite] = useState({ email: '', role: 'viewer', canManageDocuments: false, canExport: false, canInvite: false });
  const [presetId, setPresetId] = useState('');
  const [showActivity, setShowActivity] = useState(false);
  const accent = KIND_ACCENT[space.kind] ?? 'var(--accent)';
  const others = space.members.filter((member: any) => !member.isCurrent);

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    if (await onAction({ action: 'invite_member', spaceId: space.id, ...invite }, 'Inviting')) {
      setInvite({ ...invite, email: '' });
      setPresetId('');
    }
  };

  return (
    <div style={{
      border: '1px solid var(--border)', borderLeft: `3px solid ${accent}`,
      borderRadius: 'var(--r-md)', background: 'var(--bg)', padding: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...caption, color: accent }}>{KIND_LABEL[space.kind] ?? space.kind}</span>
        <strong style={{ fontSize: 15, color: 'var(--fg-strong)' }}>{space.name}</strong>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          you are {space.role} · {space.members.length} member{space.members.length === 1 ? '' : 's'} · {space.accountCount} account{space.accountCount === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        {space.canAdmin && (
          <button style={{ ...subtleButton, minHeight: 28, padding: '0 10px', fontSize: 11 }}
            onClick={() => { const name = prompt('Space name', space.name); if (name) onAction({ action: 'rename_space', spaceId: space.id, name }, 'Renaming'); }}>
            Rename
          </button>
        )}
        <a href={`/spaces?space=${space.id}`} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
          Open in Spaces →
        </a>
      </div>

      {space.succession && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-muted)' }}>
          Succession: {space.succession.enabled ? `armed with ${space.succession.successorCount} successor${space.succession.successorCount === 1 ? '' : 's'}` : 'not configured'}
          {space.succession.pendingRequest && (
            <span style={{ color: 'var(--negative)' }}>
              {' '}· a request is {space.succession.pendingRequest.status}
              <button style={{ ...dangerLink, marginLeft: 6 }}
                onClick={() => confirm('Cancel this succession request?') && onAction({ action: 'cancel_succession', requestId: space.succession.pendingRequest.id }, 'Canceling')}>
                cancel it
              </button>
            </span>
          )}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
        <div style={caption}>People</div>
        {space.members.map((member: any) => (
          <div key={member.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
            <span style={{ minWidth: 170, fontSize: 12 }}>
              <span style={{ color: 'var(--fg-strong)', fontWeight: 600 }}>{member.name || member.email}</span>
              {member.isCurrent ? ' (you)' : ''}
              <span style={{ display: 'block', fontSize: 10, color: 'var(--fg-subtle)' }}>{member.email}</span>
            </span>
            {space.canAdmin && !member.isCurrent ? (
              <>
                <select aria-label={`Role for ${member.email}`} style={{ ...input, height: 28 }} value={member.role} disabled={busy}
                  onChange={event => onAction({ action: 'update_member', spaceId: space.id, memberId: member.id, role: event.target.value }, 'Updating')}>
                  {['owner', 'manager', 'contributor', 'viewer', 'guardian', 'beneficiary', 'advisor', 'successor'].map(value => (
                    <option key={value} value={value}>{ROLE_HINTS[value] ?? value}</option>
                  ))}
                </select>
                {(['canManageDocuments', 'canExport', 'canInvite'] as const).map((flag, index) => (
                  <label key={flag} style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                    <input type="checkbox" checked={!!member[flag]} disabled={busy}
                      onChange={event => onAction({ action: 'update_member', spaceId: space.id, memberId: member.id, [flag]: event.target.checked }, 'Updating')} />
                    {' '}{['documents', 'export', 'invite'][index]}
                  </label>
                ))}
                <button style={dangerLink} onClick={() => confirm(`Remove ${member.email} from ${space.name}?`) && onAction({ action: 'remove_member', spaceId: space.id, memberId: member.id }, 'Removing')}>remove</button>
              </>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{ROLE_HINTS[member.role] ?? member.role}</span>
            )}
          </div>
        ))}
        {!!space.invites.length && (
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
            Pending: {space.invites.map((item: any) => (
              <span key={item.id} style={{ marginRight: 10 }}>
                {item.email} ({item.role}) · expires {new Date(item.expiresAt).toLocaleDateString()}
                {space.canInvite && <button style={dangerLink} onClick={() => onAction({ action: 'revoke_invite', spaceId: space.id, inviteId: item.id }, 'Revoking')}>revoke</button>}
              </span>
            ))}
          </div>
        )}
        {space.canInvite && (
          <form onSubmit={submitInvite} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 2 }}>
            <input style={{ ...input, flex: '1 1 190px' }} type="email" required placeholder="Invite by email"
              value={invite.email} onChange={event => setInvite({ ...invite, email: event.target.value })} />
            <select aria-label="Permission preset" style={input} value={presetId} onChange={event => {
              const preset = MEMBER_PRESETS.find(item => item.id === event.target.value);
              setPresetId(event.target.value);
              if (preset) setInvite({ ...invite, role: preset.role, canManageDocuments: preset.canManageDocuments, canExport: preset.canExport, canInvite: preset.canInvite });
            }}>
              <option value="">Preset…</option>
              {MEMBER_PRESETS.filter(preset => space.canAdmin || preset.role !== 'owner').map(preset => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </select>
            <select aria-label="Role" style={input} value={invite.role} onChange={event => { setInvite({ ...invite, role: event.target.value }); setPresetId(''); }}>
              {['viewer', 'advisor', 'contributor', 'manager', 'guardian', 'beneficiary', 'successor', ...(space.canAdmin ? ['owner'] : [])].map(value => (
                <option key={value} value={value}>{ROLE_HINTS[value] ?? value}</option>
              ))}
            </select>
            <button style={{ ...button, minHeight: 30 }} disabled={busy}>Invite</button>
            {presetId && <span style={{ flexBasis: '100%', fontSize: 11, color: 'var(--fg-muted)' }}>{MEMBER_PRESETS.find(item => item.id === presetId)?.description}</span>}
          </form>
        )}
      </div>

      {space.canAdmin && others.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={caption}>Hand over ownership</span>
          <select aria-label={`Transfer ownership of ${space.name}`} style={{ ...input, height: 28 }} value="" disabled={busy}
            onChange={event => event.target.value && confirm('Transfer ownership now? You become a manager.') && onAction({ action: 'transfer_ownership', spaceId: space.id, targetUserId: event.target.value }, 'Transferring')}>
            <option value="">Choose a member…</option>
            {others.map((member: any) => <option key={member.userId} value={member.userId}>{member.name || member.email}</option>)}
          </select>
        </div>
      )}

      {space.canAdmin && !!space.recentAudit.length && (
        <div style={{ marginTop: 10 }}>
          <button style={{ border: 0, background: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 11, padding: 0 }}
            onClick={() => setShowActivity(open => !open)} aria-expanded={showActivity}>
            {showActivity ? '▾' : '▸'} Recent activity ({space.recentAudit.length})
          </button>
          {showActivity && space.recentAudit.map((event: any) => (
            <div key={event.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11, color: 'var(--fg-muted)', paddingTop: 4 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-subtle)', whiteSpace: 'nowrap' }}>{new Date(event.at).toLocaleDateString()}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{event.action}</span>
              <span>{event.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HouseholdSettingsPanel({ initial }: { initial: SettingsView }) {
  const [view, setView] = useState<SettingsView>(initial);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [newSpace, setNewSpace] = useState({ name: '', beneficiaryEmail: '' });

  const refresh = async () => {
    const response = await fetch('/api/financial-spaces/settings', { cache: 'no-store' });
    if (response.ok) setView(await response.json());
  };

  const onAction = async (payload: Record<string, unknown>, label: string) => {
    setBusy(label); setMessage('');
    try {
      const response = await fetch('/api/financial-spaces', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Request failed');
      await refresh();
      setMessage('Saved');
      return true;
    } catch (error: any) {
      setMessage(error.message || 'Request failed');
      return false;
    } finally { setBusy(''); }
  };

  const createStewarded = async (event: FormEvent) => {
    event.preventDefault();
    if (await onAction({ action: 'create_stewarded', ...newSpace }, 'Creating')) setNewSpace({ name: '', beneficiaryEmail: '' });
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {(busy || message) && (
        <div role="status" style={{ fontSize: 12, color: message && message !== 'Saved' ? 'var(--negative)' : 'var(--fg-muted)' }}>
          {busy ? `${busy}…` : message}
        </div>
      )}
      {view.spaces.map(space => (
        <SpaceCard key={space.id} space={space} busy={!!busy} onAction={onAction} />
      ))}
      <form onSubmit={createStewarded} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
        <input style={{ ...input, flex: '1 1 220px' }} placeholder="New stewarded space (for a child or dependent)" required
          value={newSpace.name} onChange={event => setNewSpace({ ...newSpace, name: event.target.value })} />
        <input style={{ ...input, flex: '1 1 200px' }} type="email" placeholder="Beneficiary email (optional)"
          value={newSpace.beneficiaryEmail} onChange={event => setNewSpace({ ...newSpace, beneficiaryEmail: event.target.value })} />
        <button style={button} disabled={!!busy}>Create stewarded space</button>
      </form>
    </div>
  );
}
