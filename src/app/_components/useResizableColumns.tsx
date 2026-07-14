'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

// Column spec passed to useResizableColumns.
//   width  → starting px width (fixed-ish)
//   flex   → flex factor; the column absorbs whatever space is left after the
//            fixed widths are subtracted. Multiple flex columns split that
//            space proportionally.
//   min    → smallest width the resizer will let the user drag to
//   resizable=false → the boundary on the RIGHT of this column won't have a
//            handle. Used for tiny utility columns like checkbox / chevron.
export type ColSpec = {
  key: string;
  width?: number;
  flex?: number;
  min?: number;
  resizable?: boolean;
};

type DragState = {
  startX: number;
  startA: number;
  startB: number;
  minA: number;
  minB: number;
  idx: number;
};

// Hook that turns an array of ColSpec into a live, drag-resizable layout.
//
// Usage:
//   const { containerRef, cssVars, startDrag, isReady } = useResizableColumns('astroledger-cols-tx', cols);
//   <div ref={containerRef} style={{ ...cssVars, gridTemplateColumns: 'var(--cols)' }}>...</div>
//   // Drop <ColResizer index={i} startDrag={startDrag} /> as the last child
//   // of each header cell where you want a draggable right edge.
//
// The hook only kicks in on viewports ≥ 901px - mobile layouts re-shuffle
// the grid via globals.css and the saved px widths would fight that.
export function useResizableColumns(storageKey: string, columns: ColSpec[], opts: { gap?: number; hPad?: number } = {}) {
  const gap = opts.gap ?? 12;
  const hPad = opts.hPad ?? 44;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [widths, setWidths] = useState<number[] | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // We need the *latest* widths inside the global pointermove listener
  // without re-binding it every render - a ref bridges that.
  const widthsRef = useRef<number[] | null>(null);
  widthsRef.current = widths;

  // First-paint sizing. Read localStorage; if absent, distribute container
  // width across fixed + flex columns. useLayoutEffect avoids the flash of
  // fr-based template before the px array lands.
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 900px)').matches) {
      // On mobile, leave widths null so the consumer falls back to its
      // built-in (mobile-friendly) template.
      return;
    }
    const saved = readSaved(storageKey, columns.length);
    if (saved) { setWidths(saved); return; }

    const el = containerRef.current;
    const containerW = el ? el.clientWidth : 1100;
    // hPad subtracts the header's own horizontal padding (Card uses 22px each
    // side for table-style headers). gap × (n-1) accounts for the column-gap
    // - without it, sum(widths) + gaps would overflow the right edge.
    const usable = Math.max(containerW - hPad - gap * Math.max(columns.length - 1, 0), 320);
    const fixed = columns.reduce((acc, c) => acc + (c.width ?? 0), 0);
    const flexSum = columns.reduce((acc, c) => acc + (c.flex ?? 0), 0);
    const slack = Math.max(usable - fixed, 0);
    const initial = columns.map(c => {
      if (c.width != null) return c.width;
      if (c.flex && flexSum > 0) return Math.max(c.min ?? 80, slack * (c.flex / flexSum));
      return c.min ?? 80;
    });
    setWidths(initial);
  }, [storageKey, columns.length]); // intentionally NOT depending on `columns` identity

  const persist = useCallback((next: number[]) => {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* quota etc - best-effort */ }
    // Notify sibling shells using the same storageKey on the same page - 
    // Holdings + Accounts both render N grouped tables that should resize
    // together. The native `storage` event only fires across tabs.
    try { window.dispatchEvent(new CustomEvent('astroledger-cols-sync', { detail: storageKey })); } catch {}
  }, [storageKey]);

  // Listen for sync pings from other shells. When one drags, the rest pull
  // the new widths from localStorage and re-render in lockstep.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onSync(ev: Event) {
      const detail = (ev as CustomEvent).detail;
      if (detail !== storageKey) return;
      const saved = readSaved(storageKey, columns.length);
      if (saved) setWidths(saved);
    }
    window.addEventListener('astroledger-cols-sync', onSync);
    return () => window.removeEventListener('astroledger-cols-sync', onSync);
  }, [storageKey, columns.length]);

  // Pointer-driven resize. Adjacent columns share a fixed total (zero-sum)
  // so dragging the boundary doesn't reflow the rest of the table - 
  // that's the affordance users expect from native data grids.
  const startDrag = useCallback((idx: number, ev: ReactPointerEvent) => {
    const cur = widthsRef.current;
    if (!cur || idx < 0 || idx >= cur.length - 1) return;
    ev.preventDefault();
    ev.stopPropagation();
    const a = cur[idx], b = cur[idx + 1];
    const minA = columns[idx]?.min ?? 40;
    const minB = columns[idx + 1]?.min ?? 40;
    dragRef.current = { startX: ev.clientX, startA: a, startB: b, minA, minB, idx };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const total = d.startA + d.startB;
      const dx = e.clientX - d.startX;
      const nextA = Math.max(d.minA, Math.min(total - d.minB, d.startA + dx));
      const nextB = total - nextA;
      setWidths(prev => {
        if (!prev) return prev;
        if (prev[d.idx] === nextA && prev[d.idx + 1] === nextB) return prev;
        const next = prev.slice();
        next[d.idx] = nextA;
        next[d.idx + 1] = nextB;
        return next;
      });
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const latest = widthsRef.current;
      if (latest) persist(latest);
      dragRef.current = null;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [columns, persist]);

  // Double-click on the handle resets the boundary to the initial split,
  // computed the same way as first-paint. Per-boundary, not whole-table.
  const resetBoundary = useCallback((idx: number) => {
    setWidths(prev => {
      if (!prev) return prev;
      const el = containerRef.current;
      const containerW = el ? el.clientWidth : 1100;
      const usable = Math.max(containerW - hPad - gap * Math.max(columns.length - 1, 0), 320);
      const fixed = columns.reduce((acc, c) => acc + (c.width ?? 0), 0);
      const flexSum = columns.reduce((acc, c) => acc + (c.flex ?? 0), 0);
      const slack = Math.max(usable - fixed, 0);
      const fresh = (i: number) => {
        const c = columns[i];
        if (c.width != null) return c.width;
        if (c.flex && flexSum > 0) return Math.max(c.min ?? 80, slack * (c.flex / flexSum));
        return c.min ?? 80;
      };
      const total = prev[idx] + prev[idx + 1];
      const a = Math.min(total - (columns[idx + 1]?.min ?? 40), Math.max(columns[idx]?.min ?? 40, fresh(idx)));
      const next = prev.slice();
      next[idx] = a;
      next[idx + 1] = total - a;
      persist(next);
      return next;
    });
  }, [columns, persist]);

  const template = widths
    ? widths.map(w => `${Math.round(w)}px`).join(' ')
    : columns.map(c => (c.width != null ? `${c.width}px` : `${c.flex ?? 1}fr`)).join(' ');

  const cssVars = { ['--cols' as any]: template } as CSSProperties;

  return { containerRef, cssVars, template, startDrag, resetBoundary, isReady: widths != null, columns };
}

function readSaved(storageKey: string, expectedLen: number): number[] | null {
  try {
    const s = localStorage.getItem(storageKey);
    if (!s) return null;
    const arr = JSON.parse(s);
    if (Array.isArray(arr) && arr.length === expectedLen && arr.every((n: any) => typeof n === 'number' && n >= 0)) {
      return arr;
    }
    return null;
  } catch { return null; }
}

// Draggable boundary. Lives at the right edge of column index `index`; on
// drag it pulls width from column `index` and pushes it into `index+1`.
//
// The hit area is wider than the visible bar (16px vs 2px) for forgiveness;
// the bar lights up to the accent color on hover/active so the affordance
// is discoverable without cluttering the header.
export function ColResizer({ index, startDrag, resetBoundary }: {
  index: number;
  startDrag: (i: number, e: ReactPointerEvent) => void;
  resetBoundary?: (i: number) => void;
}) {
  const [hot, setHot] = useState(false);
  return (
    <div
      className="astroledger-col-resizer"
      onPointerDown={e => startDrag(index, e)}
      onDoubleClick={e => { e.stopPropagation(); resetBoundary?.(index); }}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onClick={e => e.stopPropagation()}
      title="Drag to resize - double-click to reset"
      style={{
        position: 'absolute', top: 0, bottom: 0, right: -8, width: 16,
        cursor: 'col-resize', zIndex: 3,
        display: 'flex', justifyContent: 'center',
        touchAction: 'none',
      }}
    >
      <div style={{
        width: 2, height: '100%',
        background: hot ? 'var(--accent)' : 'transparent',
        transition: 'background 120ms var(--ease-out)',
      }} />
    </div>
  );
}

// Shell that lets *server-rendered* tables become resizable without
// converting the whole page to a client component. Drop it around the
// header + rows; both reference `var(--cols)` for their grid template.
// Resizer handles are absolutely positioned over the header so the rendered
// markup beneath stays untouched.
//
//   <ResizableTableShell storageKey="astroledger-cols-orders" columns={ORDERS_COLS}>
//     <div style={{ display:'grid', gridTemplateColumns:'var(--cols)', padding:'10px 22px', gap:12 }}>...header cells...</div>
//     {rows.map(r => <div style={{ display:'grid', gridTemplateColumns:'var(--cols)', padding:'12px 22px', gap:12 }}>...</div>)}
//   </ResizableTableShell>
export function ResizableTableShell({ storageKey, columns, hPad = 22, gap = 12, headerHeight = 40, children, style }: {
  storageKey: string;
  columns: ColSpec[];
  hPad?: number;          // header left/right padding in px (one side)
  gap?: number;           // column-gap of header + rows in px
  headerHeight?: number;  // approx vertical extent of header (for handle height)
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { containerRef, cssVars, startDrag, resetBoundary, isReady, columns: cols } = useResizableColumns(
    storageKey, columns, { gap, hPad: hPad * 2 },
  );
  // Compute resizer x-positions from current widths + gap. The hook stores
  // widths in css vars, but we need numerics - read them off the container
  // ref after paint. Simpler approach: parse the cssVars `--cols` string.
  const template = (cssVars as any)['--cols'] as string;
  const widths = isReady && template
    ? template.split(/\s+/).map(s => parseFloat(s)).filter(n => !Number.isNaN(n))
    : [];
  const handles: ReactNode[] = [];
  if (widths.length === cols.length) {
    let x = hPad;
    for (let i = 0; i < widths.length - 1; i++) {
      x += widths[i];
      if (cols[i].resizable !== false) {
        handles.push(
          <ResizerOverlay
            key={i}
            x={x + gap / 2}
            height={headerHeight}
            onDown={e => startDrag(i, e)}
            onDouble={() => resetBoundary(i)}
          />,
        );
      }
      x += gap;
    }
  }
  return (
    <div ref={containerRef} style={{ ...cssVars, position: 'relative', ...style }}>
      {children}
      {handles}
    </div>
  );
}

function ResizerOverlay({ x, height, onDown, onDouble }: {
  x: number; height: number;
  onDown: (e: ReactPointerEvent) => void;
  onDouble: () => void;
}) {
  const [hot, setHot] = useState(false);
  return (
    <div
      onPointerDown={onDown}
      onDoubleClick={e => { e.stopPropagation(); onDouble(); }}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      title="Drag to resize - double-click to reset"
      style={{
        position: 'absolute', top: 0, left: x - 8, width: 16, height,
        cursor: 'col-resize', zIndex: 5, touchAction: 'none',
        display: 'flex', justifyContent: 'center',
      }}
    >
      <div style={{
        width: 2, height: '100%',
        background: hot ? 'var(--accent)' : 'transparent',
        transition: 'background 120ms var(--ease-out)',
      }} />
    </div>
  );
}

// Convenience wrapper for header cells. Adds the relative positioning the
// resizer needs and (optionally) the handle. Pass `last` for the final cell
// to skip the handle on the rightmost boundary.
export function ResizableHeaderCell({
  index, startDrag, resetBoundary, last, align, children, style,
}: {
  index: number;
  startDrag: (i: number, e: ReactPointerEvent) => void;
  resetBoundary?: (i: number) => void;
  last?: boolean;
  align?: 'left' | 'right' | 'center';
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{
      position: 'relative',
      textAlign: align,
      minWidth: 0,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      ...style,
    }}>
      {children}
      {!last && <ColResizer index={index} startDrag={startDrag} resetBoundary={resetBoundary} />}
    </div>
  );
}
