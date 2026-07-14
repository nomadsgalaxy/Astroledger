'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

type Align = 'start' | 'end';
type Placement = 'down' | 'up';

/**
 * Renders its children in a fixed-position portal anchored to `triggerRef`.
 * Escapes parent `overflow: hidden` and `overflow: auto` so dropdowns shown
 * inside scrollable tables/cards aren't clipped.
 *
 * - Auto-flips up when there's not enough room below.
 * - Re-positions on scroll (capture-phase, so inner scrollers trigger too)
 *   and on window resize.
 * - Clicks outside the trigger AND outside the dropdown call `onClose`.
 * - Clicks inside the dropdown don't bubble (event.stopPropagation), so the
 *   parent row's onClick (e.g. "expand details") doesn't fire.
 * - z-index defaults to 1000 - well above the sticky topbar (z 5).
 */
export default function DropdownPortal({
  triggerRef, open, onClose,
  width = 280, maxHeight = 360, align = 'start', gap = 6,
  style, children,
}: {
  triggerRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  width?: number;
  maxHeight?: number;
  align?: Align;
  gap?: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const dropRef = useRef<HTMLDivElement>(null);
  // For 'down' we anchor with `top`; for 'up' we anchor with `bottom` so the
  // popover grows upward from the trigger - this keeps it glued even when the
  // actual content is much shorter than `maxHeight`.
  const [pos, setPos] = useState<
    | { placement: 'down'; top: number; left: number }
    | { placement: 'up';   bottom: number; left: number }
    | null
  >(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      const placement: Placement = spaceBelow >= maxHeight + gap + 8 || spaceBelow >= spaceAbove ? 'down' : 'up';
      const rawLeft = align === 'end' ? r.right - width : r.left;
      const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8));
      if (placement === 'down') {
        setPos({ placement: 'down', top: r.bottom + gap, left });
      } else {
        // bottom = distance from viewport bottom to the trigger's top
        setPos({ placement: 'up', bottom: window.innerHeight - r.top + gap, left });
      }
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, width, maxHeight, align, gap, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, triggerRef]);

  if (!open || !mounted || !pos) return null;

  const positionStyle: CSSProperties = pos.placement === 'down'
    ? { top: pos.top, left: pos.left }
    : { bottom: pos.bottom, left: pos.left };

  return createPortal(
    <div
      ref={dropRef}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', ...positionStyle,
        width, maxHeight, overflowY: 'auto',
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-sm)', boxShadow: '0 8px 24px rgba(0,0,0,0.32)',
        padding: 6, zIndex: 1000,
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
