// On-demand orchestration of the Ollama Docker container.
// Mirrors the spirit of Synaptic: keep VRAM free until needed, lazy-start, auto-stop.

import { spawn } from 'node:child_process';
import { llmAvailable, llmConfig } from './llm';

const STATE: { lastTouched: number; stopTimer?: NodeJS.Timeout } = { lastTouched: 0 };

function exec(cmd: string, args: string[], timeoutMs = 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { shell: true });
    let stdout = '', stderr = '';
    const to = setTimeout(() => proc.kill(), timeoutMs);
    proc.stdout?.on('data', d => stdout += d.toString());
    proc.stderr?.on('data', d => stderr += d.toString());
    proc.on('close', code => { clearTimeout(to); resolve({ code: code ?? 1, stdout, stderr }); });
  });
}

async function waitForOllama(timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await llmAvailable()) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function ensureModelPulled(model: string) {
  const tags = await fetch('http://localhost:11434/api/tags').then(r => r.json()).catch(() => null);
  const names: string[] = (tags?.models ?? []).map((m: any) => m.name);
  if (names.includes(model)) return;
  await exec('docker', ['exec', 'astroledger-ollama', 'ollama', 'pull', model], 30 * 60_000);
}

export async function ensureLlmRunning(): Promise<{ ok: boolean; started: boolean; error?: string }> {
  STATE.lastTouched = Date.now();
  if (await llmAvailable()) {
    scheduleAutoStop();
    return { ok: true, started: false };
  }
  if (process.env.AUTO_START_LLM !== 'true') {
    return { ok: false, started: false, error: 'LLM not running. Set AUTO_START_LLM=true or run `npm run llm:up`.' };
  }
  const up = await exec('docker', ['compose', '--profile', 'llm', 'up', '-d', 'ollama']);
  if (up.code !== 0) return { ok: false, started: false, error: `docker compose failed: ${up.stderr}` };
  const ready = await waitForOllama();
  if (!ready) return { ok: false, started: true, error: 'Ollama did not become ready in time.' };
  try { await ensureModelPulled(llmConfig().model); } catch { /* will surface on first call */ }
  scheduleAutoStop();
  return { ok: true, started: true };
}

function scheduleAutoStop() {
  const idleMs = parseInt(process.env.LLM_AUTO_STOP_AFTER_MS || '600000'); // 10 min default
  if (!Number.isFinite(idleMs) || idleMs <= 0) return;
  if (STATE.stopTimer) clearTimeout(STATE.stopTimer);
  STATE.stopTimer = setTimeout(async () => {
    const idle = Date.now() - STATE.lastTouched;
    if (idle >= idleMs) {
      await exec('docker', ['compose', '--profile', 'llm', 'stop', 'ollama']);
    }
  }, idleMs + 1000);
}

export function touchLlm() { STATE.lastTouched = Date.now(); }
