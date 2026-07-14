'use client';
import { useState } from 'react';
import { Btn } from './atoms';

type Msg = { role: 'user' | 'assistant'; content: string };

export default function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!input.trim() || busy) return;
    const next = [...messages, { role: 'user' as const, content: input.trim() }];
    setMessages(next); setInput(''); setBusy(true); setError(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'LLM error'); setBusy(false); return; }
      setMessages([...next, { role: 'assistant', content: data.reply }]);
    } catch (e: any) {
      setError(e.message ?? 'Network error');
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        maxHeight: 320, overflowY: 'auto',
        border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
        background: 'var(--bg-subtle)', padding: 12,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Start a conversation…</div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <div className="t-caption" style={{ fontSize: 9, marginBottom: 2, color: m.role === 'user' ? 'var(--accent)' : 'var(--success)' }}>{m.role}</div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: m.role === 'user' ? 'var(--fg-muted)' : 'var(--fg-strong)' }}>{m.content}</div>
          </div>
        ))}
        {busy && <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Thinking…</div>}
        {error && <div style={{ fontSize: 12, color: 'var(--error)' }}>{error}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') send(); }}
               placeholder="Ask about your budget…"
               style={{
                 flex: 1, height: 36, padding: '0 12px',
                 border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                 background: 'var(--bg-elevated)', color: 'var(--fg)',
                 fontSize: 13, outline: 'none',
               }} />
        <Btn variant="primary" onClick={send} disabled={busy}>Send</Btn>
      </div>
    </div>
  );
}
