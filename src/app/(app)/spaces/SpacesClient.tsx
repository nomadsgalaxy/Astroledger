'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import SharedExpensesPanel from '@/app/_components/SharedExpensesPanel';
import AllowancePanel from '@/app/_components/AllowancePanel';
import { MEMBER_PRESETS, ROLE_HINTS } from '@/lib/memberPresets';

type Workspace = any;

const panel: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--bg-elevated)', padding: 20,
};
const input: React.CSSProperties = {
  height: 38, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg)',
  color: 'var(--fg-strong)', padding: '0 10px', fontFamily: 'var(--font-body)', fontSize: 13,
};
const button: React.CSSProperties = {
  minHeight: 38, border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)', background: 'var(--accent)',
  color: 'white', padding: '0 14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)',
};
const subtleButton: React.CSSProperties = { ...button, background: 'transparent', color: 'var(--fg-strong)', borderColor: 'var(--border)' };
const dangerButton: React.CSSProperties = { ...subtleButton, color: 'var(--negative)', borderColor: 'color-mix(in srgb, var(--negative) 45%, var(--border))' };

function kindLabel(kind: string) {
  return kind === 'personal' ? 'Private finances' : kind === 'stewarded' ? 'Stewarded finances' : 'Shared household';
}

export default function SpacesClient({ initial }: { initial: Workspace }) {
  const [workspace, setWorkspace] = useState(initial);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [invite, setInvite] = useState({ email: '', role: 'viewer', canManageDocuments: false, canExport: false, canInvite: false });
  const [presetId, setPresetId] = useState('');
  const [newSpace, setNewSpace] = useState({ name: '', beneficiaryEmail: '' });
  const [grant, setGrant] = useState({ accountId: '', granteeSpaceId: '', granteeUserEmail: '', accessLevel: 'view', documentAccess: 'none', canExport: false, canShare: false, expiresAt: '' });
  const [documents, setDocuments] = useState<any[]>([]);
  const [successors, setSuccessors] = useState(() => (initial.succession?.successors ?? []).map((item: any) => item.email).join('\n'));
  const [succession, setSuccession] = useState({
    enabled: !!initial.succession?.enabled,
    minimumApprovals: initial.succession?.minimumApprovals ?? 1,
    waitingPeriodDays: initial.succession?.waitingPeriodDays ?? 30,
    instructions: initial.succession?.instructions ?? '',
    infrastructureChecklist: (() => { try { return JSON.parse(initial.succession?.infrastructureChecklist ?? '[]').join('\n'); } catch { return ''; } })(),
  });

  const active = workspace.active;
  const canAdmin = !!active.canAdmin;
  const canManageAnyDocument = active.canManageDocuments || workspace.accounts.some((account: any) => account.documentAccess === 'manage');
  const spacesById = useMemo(() => new Map<string, any>(workspace.shareTargetSpaces.map((s: any) => [s.id, s])), [workspace.shareTargetSpaces]);
  const usersById = useMemo(() => new Map<string, any>(workspace.grantUsers.map((u: any) => [u.id, u])), [workspace.grantUsers]);

  const post = async (payload: Record<string, unknown>, label = 'Saving') => {
    setBusy(label); setMessage('');
    try {
      const response = await fetch('/api/financial-spaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Request failed');
      if (data.workspace) setWorkspace(data.workspace);
      setMessage('Saved');
      return true;
    } catch (error: any) {
      setMessage(error.message || 'Request failed');
      return false;
    } finally { setBusy(''); }
  };

  const switchSpace = async (spaceId: string) => {
    if (await post({ action: 'select_space', spaceId }, 'Switching')) window.location.reload();
  };

  const loadDocuments = async () => {
    const response = await fetch('/api/documents', { cache: 'no-store' });
    if (response.ok) setDocuments((await response.json()).documents ?? []);
  };
  useEffect(() => { loadDocuments(); }, [workspace.activeSpaceId]);

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    if (await post({ action: 'invite_member', spaceId: active.id, ...invite }, 'Inviting')) setInvite({ ...invite, email: '' });
  };

  const submitNewSpace = async (event: FormEvent) => {
    event.preventDefault();
    if (await post({ action: 'create_stewarded', ...newSpace }, 'Creating')) setNewSpace({ name: '', beneficiaryEmail: '' });
  };

  const submitGrant = async (event: FormEvent) => {
    event.preventDefault();
    const payload: any = { action: 'set_account_grant', ...grant, expiresAt: grant.expiresAt || null };
    if (grant.granteeUserEmail) delete payload.granteeSpaceId; else delete payload.granteeUserEmail;
    await post(payload, 'Sharing');
  };

  const uploadDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy('Uploading'); setMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/documents', { method: 'POST', body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(data.error || 'Upload failed');
    else { setMessage('Encrypted document uploaded'); event.currentTarget.reset(); await loadDocuments(); }
    setBusy('');
  };

  const saveSuccession = async () => {
    await post({
      action: 'update_succession', spaceId: active.id, ...succession,
      successors: successors.split(/\r?\n|,/).map((address: string, priority: number) => ({ email: address.trim(), priority })).filter((item: { email: string }) => item.email),
      infrastructureChecklist: succession.infrastructureChecklist.split(/\r?\n/).map((x: string) => x.trim()).filter(Boolean),
    }, 'Saving plan');
  };

  return (
    <div style={{ display: 'grid', gap: 24, maxWidth: 1180 }}>
      <div>
        <div className="t-caption" style={{ color: 'var(--accent)', marginBottom: 6 }}>OWNERSHIP & ACCESS</div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-product)', fontSize: 30 }}>Financial spaces</h1>
        <p style={{ color: 'var(--fg-muted)', maxWidth: 820, lineHeight: 1.6 }}>
          Keep personal money private, share selected accounts with a household, delegate management to someone you trust,
          and preserve a ledger as a dependent gains autonomy or ownership changes generations.
        </p>
        {(busy || message) && <div role="status" style={{ color: message && message !== 'Saved' && !message.includes('uploaded') ? 'var(--negative)' : 'var(--fg-muted)', fontSize: 13 }}>{busy ? `${busy}…` : message}</div>}
      </div>

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Your spaces</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
          {workspace.spaces.map((space: any) => (
            <button key={space.id} onClick={() => switchSpace(space.id)} style={{
              ...subtleButton, textAlign: 'left', padding: 14, height: 'auto', borderColor: space.id === workspace.activeSpaceId ? 'var(--accent)' : 'var(--border)',
              background: space.id === workspace.activeSpaceId ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-elevated))' : 'var(--bg)',
            }}>
              <span style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: 'var(--fg-muted)', letterSpacing: '.08em' }}>{kindLabel(space.kind)}</span>
              <strong style={{ display: 'block', margin: '5px 0' }}>{space.name}</strong>
              <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{space.role} · {space.accountCount} owned account{space.accountCount === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>
        <form onSubmit={submitNewSpace} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <input style={{ ...input, flex: '1 1 220px' }} placeholder="New stewarded space (for a child or dependent)" value={newSpace.name} onChange={e => setNewSpace({ ...newSpace, name: e.target.value })} required />
          <input style={{ ...input, flex: '1 1 220px' }} type="email" placeholder="Beneficiary email (optional)" value={newSpace.beneficiaryEmail} onChange={e => setNewSpace({ ...newSpace, beneficiaryEmail: e.target.value })} />
          <button style={button} disabled={!!busy}>Create stewarded space</button>
        </form>
      </section>

      <section style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
          <div><div className="t-caption">ACTIVE SPACE</div><h2 style={{ margin: '4px 0' }}>{active.name}</h2><div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>{kindLabel(active.kind)} · You are {active.role}</div></div>
          {canAdmin && <button style={subtleButton} onClick={() => { const name = prompt('Financial space name', active.name); if (name) post({ action: 'rename_space', spaceId: active.id, name }); }}>Rename</button>}
        </div>
      </section>

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>People & delegated capabilities</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {workspace.members.map((member: any) => (
            <div key={member.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 140px repeat(3, auto) auto', gap: 12, alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
              <div><strong>{member.name || member.email}</strong><div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{member.email}{member.isCurrent ? ' · you' : ''}</div></div>
              <select style={input} value={member.role} disabled={!canAdmin} onChange={e => post({ action: 'update_member', spaceId: active.id, memberId: member.id, role: e.target.value })}>
                {['owner', 'manager', 'contributor', 'viewer', 'guardian', 'beneficiary', 'advisor', 'successor'].map(value => <option key={value} value={value}>{ROLE_HINTS[value] ?? value}</option>)}
              </select>
              {['canManageDocuments', 'canExport', 'canInvite'].map((flag, index) => <label key={flag} style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center' }}>
                <input type="checkbox" checked={!!member[flag]} disabled={!canAdmin} onChange={e => post({ action: 'update_member', spaceId: active.id, memberId: member.id, [flag]: e.target.checked })} /> {['documents', 'export', 'invite'][index]}
              </label>)}
              {canAdmin && !member.isCurrent && <button style={dangerButton} onClick={() => confirm(`Remove ${member.email}?`) && post({ action: 'remove_member', spaceId: active.id, memberId: member.id })}>Remove</button>}
            </div>
          ))}
        </div>
        {active.canInvite && <form onSubmit={submitInvite} style={{ display: 'grid', gap: 8, marginTop: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input style={{ ...input, flex: '1 1 230px' }} type="email" placeholder="Email a family member, advisor, or trusted helper" required value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} />
            <select style={input} aria-label="Permission preset" value={presetId} onChange={e => {
              const preset = MEMBER_PRESETS.find(item => item.id === e.target.value);
              setPresetId(e.target.value);
              if (preset) setInvite({ ...invite, role: preset.role, canManageDocuments: preset.canManageDocuments, canExport: preset.canExport, canInvite: preset.canInvite });
            }}>
              <option value="">Preset…</option>
              {MEMBER_PRESETS.filter(preset => canAdmin || preset.role !== 'owner').map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </select>
            <select style={input} aria-label="Role" value={invite.role} onChange={e => { setInvite({ ...invite, role: e.target.value }); setPresetId(''); }}>
              {['viewer', 'advisor', 'contributor', 'manager', 'guardian', 'beneficiary', 'successor', ...(canAdmin ? ['owner'] : [])].map(value => <option key={value} value={value}>{ROLE_HINTS[value] ?? value}</option>)}
            </select>
            <label style={{ fontSize: 12 }}><input type="checkbox" checked={invite.canManageDocuments} onChange={e => { setInvite({ ...invite, canManageDocuments: e.target.checked }); setPresetId(''); }} /> documents</label>
            <label style={{ fontSize: 12 }}><input type="checkbox" checked={invite.canExport} onChange={e => { setInvite({ ...invite, canExport: e.target.checked }); setPresetId(''); }} /> export</label>
            <button style={button} disabled={!!busy}>Invite</button>
          </div>
          {presetId && <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{MEMBER_PRESETS.find(item => item.id === presetId)?.description}</div>}
        </form>}
        {!!workspace.invites.length && <div style={{ marginTop: 14, color: 'var(--fg-muted)', fontSize: 12 }}>
          Pending: {workspace.invites.map((item: any) => <span key={item.id} style={{ marginRight: 12 }}>{item.email} ({item.role}) <button style={{ border: 0, background: 'none', color: 'var(--negative)', cursor: 'pointer' }} onClick={() => post({ action: 'revoke_invite', spaceId: active.id, inviteId: item.id })}>revoke</button></span>)}
        </div>}
      </section>

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Accounts & sharing</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {workspace.accounts.map((account: any) => <div key={account.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, background: 'var(--bg)' }}>
            <div className="t-caption">{account.ownerSpaceId === active.id ? 'OWNED HERE' : 'SHARED TO YOU'} · {account.accessLevel}</div>
            <strong style={{ display: 'block', margin: '6px 0' }}>{account.name}{account.mask ? ` · ${account.mask}` : ''}</strong>
            <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{account.institution.name} · {account.currency} {account.balance == null ? '—' : account.balance.toLocaleString(undefined, { style: 'currency', currency: account.currency })}</div>
            {account.grants.map((item: any) => <div key={item.id} style={{ marginTop: 10, fontSize: 11, color: 'var(--fg-muted)' }}>
              {item.granteeSpaceId ? spacesById.get(item.granteeSpaceId)?.name ?? 'Space' : usersById.get(item.granteeUserId)?.email ?? 'Person'}: {item.accessLevel}, documents {item.documentAccess}{item.canExport ? ', export' : ''}
              <button style={{ border: 0, background: 'none', color: 'var(--negative)', cursor: 'pointer' }} onClick={() => post({ action: 'remove_account_grant', accountId: account.id, grantId: item.id })}>remove</button>
            </div>)}
            {account.accessLevel === 'owner' && <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
              <select aria-label={`Move ${account.name} to another space`} style={{ ...input, width: '100%' }} value="" onChange={e => e.target.value && confirm('Move this account? Its history stays intact.') && post({ action: 'move_account', accountId: account.id, targetSpaceId: e.target.value })}>
                <option value="">Move account to another owned space…</option>
                {workspace.shareTargetSpaces.filter((s: any) => s.id !== account.ownerSpaceId).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {workspace.accounts.some((sibling: any) => sibling.id !== account.id && sibling.institutionId === account.institutionId) && (
                <select aria-label={`Move the whole ${account.institution.name} connection to another space`} style={{ ...input, width: '100%' }} value=""
                  onChange={e => e.target.value && confirm(`Move the entire ${account.institution.name} connection (all of its accounts) together? Syncing keeps working.`) && post({ action: 'move_connection', institutionId: account.institutionId, targetSpaceId: e.target.value })}>
                  <option value="">Move whole {account.institution.name} connection…</option>
                  {workspace.shareTargetSpaces.filter((s: any) => s.id !== account.ownerSpaceId).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>}
          </div>)}
          {!workspace.accounts.length && <p style={{ color: 'var(--fg-muted)' }}>No accounts are visible in this space yet.</p>}
        </div>
        {!!workspace.accounts.some((a: any) => a.accessLevel === 'owner') && <form onSubmit={submitGrant} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <select style={input} required value={grant.accountId} onChange={e => setGrant({ ...grant, accountId: e.target.value })}><option value="">Account to share…</option><option value="*">All accounts owned here</option>{workspace.accounts.filter((a: any) => a.accessLevel === 'owner').map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select style={input} value={grant.granteeSpaceId} onChange={e => setGrant({ ...grant, granteeSpaceId: e.target.value, granteeUserEmail: '' })}><option value="">Share to a space…</option>{workspace.shareTargetSpaces.filter((s: any) => s.id !== active.id).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <input style={input} type="email" placeholder="Or existing user's email" value={grant.granteeUserEmail} onChange={e => setGrant({ ...grant, granteeUserEmail: e.target.value, granteeSpaceId: '' })} />
          <select style={input} value={grant.accessLevel} onChange={e => setGrant({ ...grant, accessLevel: e.target.value })}>{['summary', 'view', 'manage'].map(v => <option key={v}>{v}</option>)}</select>
          <select style={input} value={grant.documentAccess} onChange={e => setGrant({ ...grant, documentAccess: e.target.value })}>{['none', 'view', 'manage'].map(v => <option key={v} value={v}>documents: {v}</option>)}</select>
          <label style={{ fontSize: 12 }}><input type="checkbox" checked={grant.canExport} onChange={e => setGrant({ ...grant, canExport: e.target.checked })} /> allow export</label>
          <button style={button}>Share account</button>
        </form>}
      </section>

      <SharedExpensesPanel key={`split-${workspace.activeSpaceId}`} members={workspace.members} />

      {active.kind === 'stewarded' && (
        <AllowancePanel key={`allowance-${workspace.activeSpaceId}`} members={workspace.members} accounts={workspace.accounts} />
      )}

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Encrypted document vault</h2>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Statements, tax records, insurance files, and estate instructions are encrypted before they touch disk.</p>
        {canManageAnyDocument && <form onSubmit={uploadDocument} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input style={{ ...input, paddingTop: 7 }} type="file" name="file" required />
          <select style={input} name="kind"><option>statement</option><option>tax</option><option>insurance</option><option>estate</option><option>other</option></select>
          <select style={input} name="accountId">{active.canManageDocuments && <option value="">Whole space</option>}{workspace.accounts.filter((a: any) => a.documentAccess === 'manage').map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <input style={{ ...input, flex: '1 1 180px' }} name="notes" placeholder="Notes (optional)" />
          <button style={button}>Upload encrypted</button>
        </form>}
        <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          {documents.map(doc => <div key={doc.id} style={{ display: 'flex', gap: 12, alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 9 }}>
            <div style={{ flex: 1 }}><strong style={{ fontSize: 13 }}>{doc.name}</strong><div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{doc.kind} · {(doc.byteSize / 1024).toFixed(1)} KB · {doc.account?.name ?? 'whole space'}</div></div>
            <a href={`/api/documents/${doc.id}`} style={{ ...subtleButton, display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>Export</a>
            {canManageAnyDocument && <button style={dangerButton} onClick={async () => { if (!confirm('Delete this encrypted document?')) return; await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' }); loadDocuments(); }}>Delete</button>}
          </div>)}
        </div>
      </section>

      {(canAdmin || active.role === 'successor') && <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Continuity & succession</h2>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13, lineHeight: 1.55 }}>Emergency succession never triggers from inactivity alone. A nominated successor must request it, the configured quorum must approve, and the waiting period must elapse.</p>
        {canAdmin && <div style={{ display: 'grid', gap: 10 }}>
          <label><input type="checkbox" checked={succession.enabled} onChange={e => setSuccession({ ...succession, enabled: e.target.checked })} /> Enable emergency succession</label>
          <div style={{ display: 'flex', gap: 8 }}><label style={{ fontSize: 12 }}>Approvals <input style={{ ...input, width: 80, marginLeft: 5 }} type="number" min="1" value={succession.minimumApprovals} onChange={e => setSuccession({ ...succession, minimumApprovals: +e.target.value })} /></label><label style={{ fontSize: 12 }}>Waiting days <input style={{ ...input, width: 90, marginLeft: 5 }} type="number" min="1" value={succession.waitingPeriodDays} onChange={e => setSuccession({ ...succession, waitingPeriodDays: +e.target.value })} /></label></div>
          <textarea style={{ ...input, height: 78, paddingTop: 8 }} placeholder="Successor emails, one per line" value={successors} onChange={e => setSuccessors(e.target.value)} />
          <textarea style={{ ...input, height: 78, paddingTop: 8 }} placeholder="Instructions for the successor (never put passwords or recovery keys here)" value={succession.instructions} onChange={e => setSuccession({ ...succession, instructions: e.target.value })} />
          <textarea style={{ ...input, height: 62, paddingTop: 8 }} placeholder="Infrastructure checklist, one item per line" value={succession.infrastructureChecklist} onChange={e => setSuccession({ ...succession, infrastructureChecklist: e.target.value })} />
          <button style={{ ...button, justifySelf: 'start' }} onClick={saveSuccession}>Save succession plan</button>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <label style={{ fontSize: 12 }}>Planned ownership transfer: </label>
            <select style={input} defaultValue="" onChange={e => e.target.value && confirm('Transfer ownership now and become a manager?') && post({ action: 'transfer_ownership', spaceId: active.id, targetUserId: e.target.value })}>
              <option value="">Choose an existing member…</option>{workspace.members.filter((m: any) => !m.isCurrent).map((m: any) => <option key={m.userId} value={m.userId}>{m.name || m.email}</option>)}
            </select>
          </div>
        </div>}
        {active.role === 'successor' && !workspace.succession?.requests?.some((request: any) => ['pending', 'approved'].includes(request.status)) && <button style={button} onClick={() => post({ action: 'request_succession', spaceId: active.id, reason: 'Continuity plan requested by nominated successor' })}>Begin succession request</button>}
        {workspace.succession?.requests?.map((request: any) => <div key={request.id} style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <strong>Succession request: {request.status}</strong> · eligible after {new Date(request.executeAfter).toLocaleDateString()} · {request.approvals.length} decision(s)
          {active.role === 'successor' && <><button style={{ ...subtleButton, marginLeft: 8 }} onClick={() => post({ action: 'approve_succession', requestId: request.id })}>Approve</button><button style={dangerButton} onClick={() => post({ action: 'approve_succession', requestId: request.id, decision: 'reject' })}>Reject</button>{request.status === 'approved' && <button style={button} onClick={() => post({ action: 'execute_succession', requestId: request.id })}>Execute after wait</button>}</>}
          {['pending', 'approved'].includes(request.status) && (canAdmin || active.role === 'successor') && (
            <button style={{ ...dangerButton, marginLeft: 8 }} onClick={() => confirm('Cancel this succession request?') && post({ action: 'cancel_succession', requestId: request.id })}>Cancel request</button>
          )}
        </div>)}
      </section>}

      {canAdmin && !!workspace.auditEvents?.length && <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Audit history</h2>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Every permission, sharing, document, export, and continuity change in this space — most recent first. This trail is append-only.</p>
        <div style={{ display: 'grid', gap: 0 }}>
          {workspace.auditEvents.map((event: any) => <div key={event.id} style={{ display: 'flex', gap: 12, alignItems: 'baseline', borderTop: '1px solid var(--border)', padding: '8px 0' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-subtle)', whiteSpace: 'nowrap' }}>{new Date(event.at).toLocaleString()}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{event.action}</span>
            <span style={{ fontSize: 13, flex: 1 }}>{event.summary}{event.reason ? ` — ${event.reason}` : ''}</span>
          </div>)}
        </div>
      </section>}

      {canAdmin && active.kind === 'stewarded' && <section style={{ ...panel, borderColor: 'color-mix(in srgb, var(--accent) 40%, var(--border))' }}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Grant the beneficiary autonomy</h2>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>The space keeps its complete history and stable identity. The beneficiary becomes owner; guardians can retain manage, view-only, or no access.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <select id="beneficiary" style={input} defaultValue={active.beneficiaryUserId ?? ''}><option value="">Invite a beneficiary first…</option>{workspace.members.filter((m: any) => m.role === 'beneficiary' || m.userId === active.beneficiaryUserId).map((m: any) => <option key={m.userId} value={m.userId}>{m.name || m.email}</option>)}</select>
          <select id="guardianAccess" style={input} defaultValue="view"><option value="none">Guardian: no access</option><option value="view">Guardian: view only</option><option value="manage">Guardian: keep managing</option></select>
          <button style={button} onClick={() => {
            const beneficiaryUserId = (document.getElementById('beneficiary') as HTMLSelectElement).value;
            const guardianAccess = (document.getElementById('guardianAccess') as HTMLSelectElement).value;
            if (beneficiaryUserId && confirm('Grant autonomy now? This transfers ownership.')) post({ action: 'grant_autonomy', spaceId: active.id, beneficiaryUserId, guardianAccess });
          }}>Grant autonomy</button>
        </div>
      </section>}
    </div>
  );
}
