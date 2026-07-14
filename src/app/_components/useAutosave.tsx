'use client';
import { useRef, useState, useCallback, useEffect } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * useAutosave - debounced fire-and-forget saver.
 *
 * Pattern:
 *   const { state, schedule } = useAutosave(async (payload) => { await fetch(...) });
 *   <input onChange={e => { setValue(e.target.value); schedule(e.target.value); }} />
 *
 * Coalesces rapid edits inside `wait` ms. Shows transient "saved" pulse
 * for 1.5s after each successful write. Always saves the latest payload.
 */
export function useAutosave<T>(
  save: (payload: T) => Promise<void>,
  wait = 600,
) {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<T | null>(null);
  const latestSave = useRef(save);
  useEffect(() => { latestSave.current = save; }, [save]);

  const flush = useCallback(async () => {
    if (pending.current === null) return;
    const payload = pending.current;
    pending.current = null;
    setState('saving');
    try {
      await latestSave.current(payload);
      setState('saved');
      setTimeout(() => setState(s => (s === 'saved' ? 'idle' : s)), 1500);
    } catch {
      setState('error');
    }
  }, []);

  const schedule = useCallback((payload: T) => {
    pending.current = payload;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, wait);
  }, [flush, wait]);

  const saveNow = useCallback((payload: T) => {
    pending.current = payload;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    return flush();
  }, [flush]);

  return { state, schedule, saveNow };
}

/** Tiny pulse used next to a field/section that's autosaving. */
export function SaveIndicator({ state }: { state: SaveState }) {
  const label = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Error' : '';
  const color = state === 'error' ? 'var(--error)' : state === 'saved' ? 'var(--success)' : 'var(--fg-muted)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 10, fontFamily: 'var(--font-product)', fontWeight: 700,
      letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
      color, opacity: state === 'idle' ? 0 : 1, transition: 'opacity var(--dur-fast)',
      minWidth: 56,
    }}>
      {state !== 'idle' && (
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: color,
          animation: state === 'saving' ? 'pulse 1s ease-in-out infinite' : 'none',
        }} />
      )}
      {label}
    </span>
  );
}
