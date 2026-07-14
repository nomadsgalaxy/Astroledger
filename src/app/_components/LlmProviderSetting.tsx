'use client';

import { useEffect, useState } from 'react';
import { Btn, Pill } from './atoms';

type ProviderKind = 'ollama' | 'openai' | 'custom' | 'anthropic' | 'disabled';

type Config = {
  kind: ProviderKind;
  baseUrl?: string;
  model?: string;
  fastModel?: string;
  apiKeyEnv?: string;
  systemPromptOverride?: string;
  timeoutMs?: number;
  displayName?: string;
};

// One source of truth for the dropdown and the per-kind defaults shown when
// the user picks a kind for the first time.
const KIND_PRESETS: Record<ProviderKind, { label: string; baseUrl: string; model: string; fastModel: string; apiKeyEnv: string; help: string }> = {
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b-instruct',
    fastModel: 'llama3.2:3b',
    apiKeyEnv: '',
    help: 'Local Ollama daemon. Pull models with `ollama pull <name>`. No API key needed.',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    fastModel: 'gpt-4o-mini',
    apiKeyEnv: 'OPENAI_API_KEY',
    help: 'OpenAI proper. Set OPENAI_API_KEY in your .env (or your hosting platform secrets) and restart.',
  },
  custom: {
    label: 'Custom OpenAI-compatible',
    baseUrl: 'http://localhost:1234/v1',
    model: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
    fastModel: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
    apiKeyEnv: '',
    help: 'Use for LM Studio, vLLM, llama.cpp server, OpenRouter, Groq, or any endpoint that speaks OpenAI /v1/chat/completions.',
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-haiku-4-5',
    fastModel: 'claude-haiku-4-5',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    help: 'Anthropic /v1/messages. Set ANTHROPIC_API_KEY in your .env and restart. Astroledger translates tool-call shape automatically.',
  },
  disabled: {
    label: 'Disabled (no chat / no auto-categorize)',
    baseUrl: '',
    model: '',
    fastModel: '',
    apiKeyEnv: '',
    help: 'Spacer chat and LLM-assisted auto-categorize will no-op. Other features unaffected.',
  },
};

export default function LlmProviderSetting() {
  const [cfg, setCfg] = useState<Config>({ kind: 'ollama' });
  const [original, setOriginal] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/settings/llm');
        const j = await r.json();
        if (j.config) {
          setCfg(j.config);
          setOriginal(j.config);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function pickKind(kind: ProviderKind) {
    // Replace the whole config with the preset for the chosen kind. The user
    // can edit fields after. Avoids "I switched from ollama to openai and now
    // the model field still says qwen2.5".
    const p = KIND_PRESETS[kind];
    setCfg({
      kind,
      baseUrl: p.baseUrl,
      model: p.model,
      fastModel: p.fastModel,
      apiKeyEnv: p.apiKeyEnv,
      systemPromptOverride: cfg.systemPromptOverride,
      timeoutMs: cfg.timeoutMs,
    });
    setTestResult(null);
  }

  function update<K extends keyof Config>(k: K, v: Config[K]) {
    setCfg(c => ({ ...c, [k]: v }));
    setTestResult(null);
  }

  async function test() {
    setTesting(true); setMsg(null); setTestResult(null);
    try {
      const r = await fetch('/api/settings/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const j = await r.json();
      if (j.ok) {
        setTestResult({ ok: true, text: `OK (${j.latencyMs}ms) — model replied "${j.sample}"` });
      } else {
        setTestResult({ ok: false, text: j.error ?? 'unknown error' });
      }
    } catch (e) {
      setTestResult({ ok: false, text: (e as Error).message });
    } finally { setTesting(false); }
  }

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const j = await r.json();
      if (!r.ok) { setMsg(`Error: ${j.error}`); return; }
      setOriginal(cfg);
      setMsg('Saved.');
    } finally { setSaving(false); }
  }

  async function resetToEnv() {
    setSaving(true); setMsg(null);
    try {
      await fetch('/api/settings/llm', { method: 'DELETE' });
      setCfg({ kind: 'ollama' });
      setOriginal(null);
      setMsg('Reset — provider now reads from env vars (OLLAMA_BASE_URL / LLM_MODEL / OPENAI_API_KEY).');
    } finally { setSaving(false); }
  }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Loading…</div>;

  const dirty = JSON.stringify(cfg) !== JSON.stringify(original);
  const preset = KIND_PRESETS[cfg.kind];
  const needsKey = cfg.kind === 'openai' || cfg.kind === 'anthropic';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Row label="Provider">
        <select value={cfg.kind} onChange={e => pickKind(e.target.value as ProviderKind)} style={selStyle}>
          {(Object.keys(KIND_PRESETS) as ProviderKind[]).map(k => (
            <option key={k} value={k}>{KIND_PRESETS[k].label}</option>
          ))}
        </select>
      </Row>

      <div style={{ fontSize: 11, color: 'var(--fg-subtle)', lineHeight: 1.5 }}>{preset.help}</div>

      {cfg.kind !== 'disabled' && (
        <>
          <Row label="Base URL">
            <input type="text" value={cfg.baseUrl ?? ''} onChange={e => update('baseUrl', e.target.value)}
                   placeholder={preset.baseUrl} style={inpStyle} />
          </Row>
          <Row label="Default model">
            <input type="text" value={cfg.model ?? ''} onChange={e => update('model', e.target.value)}
                   placeholder={preset.model} style={inpStyle} />
          </Row>
          <Row label="Fast model">
            <input type="text" value={cfg.fastModel ?? ''} onChange={e => update('fastModel', e.target.value)}
                   placeholder={preset.fastModel} style={inpStyle} />
          </Row>
          {needsKey && (
            <Row label="API key env var">
              <input type="text" value={cfg.apiKeyEnv ?? ''} onChange={e => update('apiKeyEnv', e.target.value)}
                     placeholder={preset.apiKeyEnv} style={inpStyle} />
              <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 4 }}>
                Name of the env var, not the key itself. The key value never enters the database.
              </div>
            </Row>
          )}
          <Row label="System prompt override (optional)">
            <textarea value={cfg.systemPromptOverride ?? ''} onChange={e => update('systemPromptOverride', e.target.value)}
                      placeholder="Prepended to every Spacer call when no system message is provided. Leave blank to use the built-in Spacer prompt."
                      rows={3} style={{ ...inpStyle, fontFamily: 'inherit', resize: 'vertical' }} />
          </Row>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
        <Btn variant="ghost" size="sm" onClick={test} disabled={testing || cfg.kind === 'disabled'}>
          {testing ? 'Testing…' : 'Test connection'}
        </Btn>
        <Btn variant="primary" size="sm" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Btn>
        <Btn variant="ghost" size="sm" onClick={resetToEnv} disabled={saving}>
          Reset to env vars
        </Btn>
        {msg && <span style={{ fontSize: 11, color: msg.startsWith('Error') ? 'var(--error)' : 'var(--fg-muted)' }}>{msg}</span>}
      </div>

      {testResult && (
        <div style={{
          padding: 10, fontSize: 12,
          color: testResult.ok ? 'var(--success)' : 'var(--error)',
          background: testResult.ok ? 'rgba(40,180,80,0.06)' : 'rgba(237,0,0,0.06)',
          border: `1px solid ${testResult.ok ? 'rgba(40,180,80,0.3)' : 'rgba(237,0,0,0.3)'}`,
          borderRadius: 'var(--r-sm)',
          fontFamily: 'var(--font-mono)',
        }}>
          {testResult.ok ? '✓ ' : '✗ '}{testResult.text}
        </div>
      )}
    </div>
  );
}

const inpStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-xs)',
  background: 'var(--bg-subtle)', color: 'var(--fg)',
  fontFamily: 'var(--font-mono)', fontSize: 12,
};
const selStyle: React.CSSProperties = {
  ...inpStyle, fontFamily: 'inherit', fontSize: 13,
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{label}</span>
      {children}
    </label>
  );
}
