'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Notification = {
  id: string; at: string; kind: string; title: string;
  body?: string | null; linkPath?: string | null; readAt?: string | null;
};

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const load = async () => {
    try {
      const response = await fetch('/api/notifications');
      if (!response.ok) return;
      const data = await response.json();
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    } catch { /* transient — the next poll retries */ }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const markAll = async () => {
    await fetch('/api/notifications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read_all' }),
    });
    load();
  };

  const openItem = async (item: Notification) => {
    if (!item.readAt) {
      await fetch('/api/notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read', id: item.id }),
      });
    }
    setOpen(false);
    load();
    if (item.linkPath) router.push(item.linkPath);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: 36, height: 36, display: 'grid', placeItems: 'center',
        border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
        background: 'var(--bg-elevated)', color: 'var(--fg-strong)',
        cursor: 'pointer', fontSize: 14, fontFamily: 'var(--font-product)', position: 'relative',
      }} title="Notifications" aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'} aria-expanded={open}>
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2, minWidth: 15, height: 15, padding: '0 3px',
            borderRadius: 'var(--r-pill)', background: 'var(--accent)', color: '#fff',
            fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center', lineHeight: 1,
          }} aria-hidden="true">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 42, width: 340, maxHeight: 420, overflowY: 'auto',
          border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-elevated)',
          boxShadow: '0 8px 28px rgba(0,0,0,0.25)', zIndex: 60,
        }} role="dialog" aria-label="Notifications">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-strong)' }}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 && (
            <div style={{ padding: 18, fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center' }}>
              Nothing yet — invitations, permission changes, and succession updates will land here.
            </div>
          )}
          {items.map(item => (
            <button key={item.id} onClick={() => openItem(item)} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%', textAlign: 'left',
              padding: '10px 12px', background: 'transparent', border: 0,
              borderBottom: '1px solid var(--border)', cursor: 'pointer',
            }}>
              <span style={{
                marginTop: 5, width: 7, height: 7, flexShrink: 0, borderRadius: 'var(--r-pill)',
                background: item.readAt ? 'transparent' : 'var(--accent)',
                border: item.readAt ? '1px solid var(--border)' : 'none',
              }} aria-hidden="true" />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: item.readAt ? 500 : 700, color: 'var(--fg-strong)' }}>{item.title}</span>
                {item.body && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>{item.body}</span>}
                <span style={{ display: 'block', fontSize: 10, color: 'var(--fg-subtle)', marginTop: 2 }}>{timeAgo(item.at)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
