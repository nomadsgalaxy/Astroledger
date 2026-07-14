'use client';
import { useState, useRef, useEffect } from 'react';
import { Btn, Card, Pill } from './atoms';

type ToolCall = { name: string; args: Record<string, unknown>; resultSummary: string };
type Msg = { role: 'user' | 'assistant'; content: string; toolTrace?: ToolCall[] };

export default function ChatPageClient({ suggestions }: { suggestions: string[] }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next); setInput(''); setBusy(true); setError(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'LLM error'); setBusy(false); return; }
      setMessages([...next, { role: 'assistant', content: data.reply, toolTrace: data.toolTrace }]);
    } catch (e: any) {
      setError(e.message ?? 'Network error');
    } finally { setBusy(false); }
  }

  return (
    <Card padding={0}>
      <div style={{
        minHeight: 360, maxHeight: '60vh', overflowY: 'auto',
        padding: 22, display: 'flex', flexDirection: 'column', gap: 18,
        borderBottom: '1px solid var(--border)',
      }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Try one of these:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {suggestions.map(s => (
                <button key={s} onClick={() => send(s)} disabled={busy}
                        style={suggestionBtn}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
        {busy && <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Thinking…</div>}
        {error && <div style={{ fontSize: 12, color: 'var(--error)' }}>Error: {error}</div>}
        <div ref={endRef} />
      </div>
      <div style={{ padding: 14, display: 'flex', gap: 8 }}>
        <input value={input}
               onChange={e => setInput(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
               placeholder="Ask anything about your finances…"
               disabled={busy}
               style={{
                 flex: 1, height: 38, padding: '0 14px',
                 border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                 background: 'var(--bg-elevated)', color: 'var(--fg)',
                 fontSize: 13, outline: 'none',
               }} />
        <Btn variant="primary" onClick={() => send()} disabled={busy || !input.trim()}>Send</Btn>
      </div>
    </Card>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  const [traceOpen, setTraceOpen] = useState(false);
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 9, fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: isUser ? 'var(--accent)' : 'var(--success)' }}>
        {isUser ? 'You' : 'Spacer'}
      </div>
      <div style={{
        whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5,
        color: isUser ? 'var(--fg)' : 'var(--fg-strong)',
        background: isUser ? 'transparent' : 'var(--bg-subtle)',
        border: isUser ? 'none' : '1px solid var(--border)',
        borderRadius: 'var(--r-sm)',
        padding: isUser ? '4px 0' : '10px 12px',
      }}>
        {msg.content}
      </div>
      {!isUser && msg.toolTrace && msg.toolTrace.length > 0 && (
        <div>
          <button onClick={() => setTraceOpen(o => !o)} style={traceToggleBtn}>
            {traceOpen ? '▾' : '▸'} {msg.toolTrace.length} tool call{msg.toolTrace.length === 1 ? '' : 's'}
          </button>
          {traceOpen && (
            <div style={{ marginTop: 6, padding: 10, background: 'var(--bg-panel)', borderRadius: 'var(--r-xs)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {msg.toolTrace.map((t, i) => (
                <div key={i} style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Pill tone="info">{t.name}</Pill>
                    <span style={{ color: 'var(--fg-muted)' }}>{JSON.stringify(t.args)}</span>
                  </div>
                  <div style={{ color: 'var(--fg-subtle)', fontSize: 10, marginTop: 3, paddingLeft: 4 }}>
                    → {t.resultSummary}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const suggestionBtn: React.CSSProperties = {
  fontFamily: 'var(--font-body)', fontSize: 12,
  padding: '6px 12px', borderRadius: 'var(--r-pill)',
  border: '1px solid var(--border)', background: 'var(--bg-elevated)',
  color: 'var(--fg)', cursor: 'pointer', textAlign: 'left',
};

const traceToggleBtn: React.CSSProperties = {
  fontFamily: 'var(--font-product)', fontSize: 10, fontWeight: 700,
  letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
  height: 28, padding: '0 10px', borderRadius: 'var(--r-xs)',
  border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--fg-muted)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 5, lineHeight: 1,
  boxSizing: 'border-box',
};
