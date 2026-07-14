// LLM client. Supports multiple provider shapes selectable from Settings →
// AI. Falls back to the original env-var-driven OpenAI-compatible client
// when no AppSetting is configured (so existing self-hosters using Ollama
// keep working unchanged).
//
// Supported provider kinds (ProviderKind):
//   ollama       — OpenAI-compatible. Default. URL defaults to localhost:11434.
//   openai       — OpenAI proper or any OpenAI-compatible cloud (OpenRouter, Groq).
//   custom       — same shape as openai but with an explicit base_url. Use for
//                  LM Studio, vLLM, llama.cpp server, self-hosted text-gen.
//   anthropic    — api.anthropic.com /v1/messages. Different request/response shape.
//   disabled     — every chat() call throws. Spacer/auto-categorize degrade gracefully.
//
// API keys are NEVER stored in the database. The AppSetting row stores only
// the NAME of an env var (apiKeyEnv). The running process resolves the
// actual key at call time. This mirrors Synaptic Disorder's pattern and
// keeps secrets out of DB backups + per-visitor demo sandboxes.

export type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; name?: string };
export type ToolDef = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ProviderKind = 'ollama' | 'openai' | 'custom' | 'anthropic' | 'disabled';

export type LlmProviderConfig = {
  kind: ProviderKind;
  baseUrl?: string;
  model?: string;          // default chat model
  fastModel?: string;      // smaller/faster model for auto-categorize
  apiKeyEnv?: string;      // env var NAME, not the key itself
  systemPromptOverride?: string;
  timeoutMs?: number;      // per-call HTTP timeout
  displayName?: string;    // shows in logs / Settings UI
};

const APP_SETTING_KEY = 'llm_provider';
const ANTHROPIC_DEFAULT_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Resolves the active LLM config. Order:
 *   1. AppSetting row "llm_provider" if present (JSON-encoded LlmProviderConfig)
 *   2. Env-var fallback: OLLAMA_BASE_URL / OPENAI_API_KEY / LLM_MODEL / LLM_FAST_MODEL
 * Returns a fully-defaulted config — every field is set. Resolves the actual
 * apiKey from the env var named by apiKeyEnv.
 */
export async function getLlmConfig(): Promise<LlmProviderConfig & { apiKey: string }> {
  // Lazy-import prisma so this module stays usable in scripts that don't
  // want the Prisma client (test fixtures, CLIs).
  let dbCfg: LlmProviderConfig | null = null;
  try {
    const { prisma } = await import('./prisma');
    const row = await prisma.appSetting.findUnique({ where: { key: APP_SETTING_KEY } });
    if (row?.value) {
      const parsed = JSON.parse(row.value) as LlmProviderConfig;
      if (parsed && typeof parsed.kind === 'string') dbCfg = parsed;
    }
  } catch {
    // Prisma unavailable (e.g. script context with no DB) — fall through to env.
  }

  if (dbCfg) {
    const apiKey = dbCfg.apiKeyEnv ? (process.env[dbCfg.apiKeyEnv] ?? '') : '';
    return {
      kind: dbCfg.kind,
      baseUrl: dbCfg.baseUrl ?? defaultBaseUrl(dbCfg.kind),
      model: dbCfg.model ?? defaultModel(dbCfg.kind),
      fastModel: dbCfg.fastModel ?? dbCfg.model ?? defaultModel(dbCfg.kind),
      apiKeyEnv: dbCfg.apiKeyEnv,
      systemPromptOverride: dbCfg.systemPromptOverride,
      timeoutMs: dbCfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      displayName: dbCfg.displayName ?? `${dbCfg.kind}:${dbCfg.model ?? defaultModel(dbCfg.kind)}`,
      apiKey,
    };
  }

  // Env-var fallback (backward compat — pre-0.2.4 behavior).
  const kind: ProviderKind = 'ollama';
  const baseUrl = process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1';
  const model = process.env.LLM_MODEL || 'qwen2.5:32b-instruct';
  const fastModel = process.env.LLM_FAST_MODEL || model;
  const apiKey = process.env.OPENAI_API_KEY || 'ollama';
  return {
    kind, baseUrl, model, fastModel,
    apiKeyEnv: 'OPENAI_API_KEY',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    displayName: `${kind}:${model}`,
    apiKey,
  };
}

/** Synchronous env-only config — used by the chat API's auto-start probe.
 *  Doesn't touch the DB, so it's safe in middleware / instrumentation hooks. */
export function llmConfig() {
  return {
    baseUrl: process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1',
    apiKey: process.env.OPENAI_API_KEY || 'ollama',
    model: process.env.LLM_MODEL || 'qwen2.5:32b-instruct',
  };
}

function defaultBaseUrl(kind: ProviderKind): string {
  switch (kind) {
    case 'ollama':    return 'http://localhost:11434/v1';
    case 'openai':    return 'https://api.openai.com/v1';
    case 'anthropic': return 'https://api.anthropic.com/v1';
    default:          return 'http://localhost:11434/v1';
  }
}

function defaultModel(kind: ProviderKind): string {
  switch (kind) {
    case 'ollama':    return 'qwen2.5:7b-instruct';
    case 'openai':    return 'gpt-4o-mini';
    case 'anthropic': return 'claude-haiku-4-5';
    default:          return 'qwen2.5:7b-instruct';
  }
}

export async function llmAvailable(): Promise<boolean> {
  const cfg = await getLlmConfig();
  if (cfg.kind === 'disabled') return false;
  try {
    // For Anthropic there's no anonymous probe — accept-as-configured.
    // (A keyed /messages probe would burn $0.00xx per check; not worth it.)
    if (cfg.kind === 'anthropic') return !!cfg.apiKey;

    // For OpenAI-compatible: prefer the Ollama-specific /api/tags (works
    // without auth) and fall back to OpenAI-shape /models with auth.
    const tagsUrl = cfg.baseUrl!.replace(/\/v1\/?$/, '') + '/api/tags';
    const tagsRes = await fetch(tagsUrl, { signal: AbortSignal.timeout(1500) });
    if (tagsRes.ok) return true;
    const modelsRes = await fetch(cfg.baseUrl + '/models', {
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      signal: AbortSignal.timeout(1500),
    });
    return modelsRes.ok;
  } catch { return false; }
}

/** Issue a chat completion. Selects the right transport per provider kind. */
export async function chat(messages: ChatMessage[], opts: {
  tools?: ToolDef[];
  temperature?: number;
  model?: string;
  responseFormat?: 'json_object' | 'text';
  /** Use the fastModel instead of the default model for this call. */
  fast?: boolean;
} = {}): Promise<{
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}> {
  const cfg = await getLlmConfig();
  if (cfg.kind === 'disabled') {
    throw new Error('LLM is disabled in Settings → AI. Enable a provider to use Spacer / auto-categorize.');
  }

  const chosenModel = opts.model ?? (opts.fast ? cfg.fastModel : cfg.model) ?? cfg.model!;
  // Prepend system-prompt override (if configured) when the caller hasn't
  // already provided a system message. Lets the user pin instructions like
  // "respond concisely" or "never include numbers" across every Spacer call.
  let outgoing = messages;
  if (cfg.systemPromptOverride && !messages.some(m => m.role === 'system')) {
    outgoing = [{ role: 'system', content: cfg.systemPromptOverride }, ...messages];
  }

  if (cfg.kind === 'anthropic') {
    return chatAnthropic(outgoing, opts, cfg, chosenModel);
  }
  return chatOpenAICompatible(outgoing, opts, cfg, chosenModel);
}

async function chatOpenAICompatible(
  messages: ChatMessage[],
  opts: { tools?: ToolDef[]; temperature?: number; responseFormat?: 'json_object' | 'text' },
  cfg: LlmProviderConfig & { apiKey: string },
  chosenModel: string,
) {
  const body: any = {
    model: chosenModel,
    messages,
    temperature: opts.temperature ?? 0.2,
    stream: false,
  };
  if (opts.tools?.length) body.tools = opts.tools;
  if (opts.responseFormat === 'json_object') body.response_format = { type: 'json_object' };

  const res = await fetch(cfg.baseUrl! + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  const toolCalls = (msg.tool_calls ?? []).map((tc: any) => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: safeJson(tc.function?.arguments),
  }));
  return { content: msg.content ?? '', toolCalls: toolCalls.length ? toolCalls : undefined };
}

async function chatAnthropic(
  messages: ChatMessage[],
  opts: { tools?: ToolDef[]; temperature?: number; responseFormat?: 'json_object' | 'text' },
  cfg: LlmProviderConfig & { apiKey: string },
  chosenModel: string,
) {
  if (!cfg.apiKey) throw new Error(`Anthropic provider configured but env var ${cfg.apiKeyEnv ?? 'ANTHROPIC_API_KEY'} is unset.`);
  // Anthropic separates system prompt from messages.
  const systemMsgs = messages.filter(m => m.role === 'system').map(m => m.content);
  const turnMsgs = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));

  const body: any = {
    model: chosenModel,
    max_tokens: 4096,
    messages: turnMsgs,
    temperature: opts.temperature ?? 0.2,
  };
  if (systemMsgs.length) body.system = systemMsgs.join('\n\n');
  if (opts.tools?.length) {
    // Anthropic's tools schema uses input_schema instead of parameters.
    body.tools = opts.tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  const res = await fetch(cfg.baseUrl! + '/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': ANTHROPIC_DEFAULT_VERSION,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();

  // Anthropic returns content as an array of blocks; flatten text blocks +
  // pull out tool_use blocks for the same {id, name, arguments} contract
  // the OpenAI-compat path returns.
  const blocks = Array.isArray(data.content) ? data.content : [];
  const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  const toolCalls = blocks
    .filter((b: any) => b.type === 'tool_use')
    .map((b: any) => ({ id: b.id, name: b.name, arguments: b.input ?? {} }));
  return { content: text, toolCalls: toolCalls.length ? toolCalls : undefined };
}

function safeJson(s: unknown): Record<string, unknown> {
  if (typeof s !== 'string') return (s as any) ?? {};
  try { return JSON.parse(s); } catch { return {}; }
}
