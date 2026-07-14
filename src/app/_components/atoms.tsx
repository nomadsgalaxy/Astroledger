// Astroledger - shared UI atoms (ported from design-bundle/astroledger/project/app/atoms.jsx)
// Server-safe by default. Counter/useCountTo (the only hook-using parts) live in Counter.tsx.

import type { CSSProperties, ReactNode, MouseEventHandler } from 'react';

// ---------- formatting ----------
export const fmt = (n: number, opts: { sign?: boolean; cents?: boolean; compact?: boolean } = {}) => {
  const { sign = false, cents = true, compact = false } = opts;
  const abs = Math.abs(n);
  let s;
  if (compact && abs >= 1000) {
    s = '$' + (abs / 1000).toFixed(abs >= 10000 ? 1 : 2).replace(/\.0$/, '') + 'k';
  } else {
    s = '$' + abs.toLocaleString('en-US', {
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    });
  }
  // Don't render a sign for zero - "−$0" or "+$0" is visual noise.
  if (n === 0) return s;
  if (sign) return (n < 0 ? '−' : '+') + s;
  return n < 0 ? '−' + s : s;
};

export const fmtDate = (d: Date | string) => {
  // A plain YYYY-MM-DD is a calendar date, not a UTC instant. Feeding it to
  // Date() shifts it to the previous day in western time zones.
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [, month, day] = d.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[month - 1]} ${day}`;
  }
  const dt = typeof d === 'string' ? new Date(d) : d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[dt.getMonth()]} ${dt.getDate()}`;
};

// ---------- Animated counter ----------
// Re-exported from Counter.tsx (client component) for ergonomic single import.
export { Counter, useCountTo } from './Counter';

// ---------- Honeycomb backdrop ----------
// Regular pointy-top hexagon tiling. The pattern unit holds TWO hexes - one
// at row 0 and one offset by (size/2, yStep) at row 1 - so the SVG `pattern`
// engine produces interlocking honeycomb rows rather than a rectangular grid.
//
// Geometry for a regular pointy-top hex with width=size:
//   height = size * 2/√3  ≈  size * 1.1547
//   vertical row pitch = 0.75 * height  =  size * 0.866
//   horizontal step  = size
//   adjacent rows shifted by size/2
export function HexBackdrop({ opacity = 0.06, color = 'currentColor', size = 64 }: {
  opacity?: number; color?: string; size?: number;
}) {
  const w = size;
  const h = w * 1.1547;     // regular hex height
  const yStep = h * 0.75;   // 3/4 of height = vertical row pitch
  // Pointy-top hex centered at (w/2, h/2). 6 vertices: top, top-right, bottom-right, bottom, bottom-left, top-left.
  const hex = `M ${w/2},0 L ${w},${h*0.25} L ${w},${h*0.75} L ${w/2},${h} L 0,${h*0.75} L 0,${h*0.25} Z`;
  // Pattern repeat: width = w (single hex column), height = 2*yStep (two rows).
  const patternW = w;
  const patternH = yStep * 2;
  return (
    <svg aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity, pointerEvents: 'none' }}>
      <defs>
        <pattern id={`hexbg-${size}`} x="0" y="0" width={patternW} height={patternH} patternUnits="userSpaceOnUse">
          {/* row 0 hex at (0, 0) */}
          <path d={hex} fill="none" stroke={color} strokeWidth="1" />
          {/* row 1 hex offset by (w/2, yStep) to interlock */}
          <path d={hex} transform={`translate(${w/2}, ${yStep})`} fill="none" stroke={color} strokeWidth="1" />
          {/* extra hex at (-w/2, yStep) so the left edge of the pattern tile continues seamlessly */}
          <path d={hex} transform={`translate(${-w/2}, ${yStep})`} fill="none" stroke={color} strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#hexbg-${size})`} />
    </svg>
  );
}

// ---------- Astroledger logo mark ----------
// Pure-SVG version of the brand mark (no text/font dependency). Single shape
// with even-odd fill: pointy-top hexagon with a 4-point sparkle knocked out.
// Use this instead of `<Hex><span>✦</span></Hex>` wherever the brand mark is
// needed - favicons, sidebar wordmark, sign-in card, etc.
export function LogoMark({ size = 24, color = 'var(--accent)', style, title }: {
  size?: number; color?: string; style?: CSSProperties; title?: string;
}) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"
         width={size} height={size * 1.15}
         role="img" aria-label={title ?? 'Astroledger'}
         style={{ color, display: 'block', ...style }}>
      <path fill="currentColor" fillRule="evenodd"
            d="M50 2 L93.3 27 L93.3 73 L50 98 L6.7 73 L6.7 27 Z
               M82 50 A32 32 0 1 0 18 50 A32 32 0 1 0 82 50 Z
               M78 50 A28 28 0 1 0 22 50 A28 28 0 1 0 78 50 Z
               M50 30 L46 46 L30 50 L46 54 L50 70 L54 54 L70 50 L54 46 Z" />
    </svg>
  );
}

// ---------- Hex shape ----------
export function Hex({ size = 24, color = 'var(--accent)', className, style, children, onClick, title, outline }: {
  size?: number; color?: string; className?: string; style?: CSSProperties;
  children?: ReactNode; onClick?: MouseEventHandler; title?: string; outline?: boolean;
}) {
  const w = size, h = size * 1.15;
  return (
    <div className={className} title={title} onClick={onClick} style={{
      width: w, height: h,
      clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
      background: outline ? 'transparent' : color,
      display: 'grid', placeItems: 'center', position: 'relative',
      cursor: onClick ? 'pointer' : 'default',
      ...style,
    }}>
      {outline && (
        <svg viewBox="0 0 100 115" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <polygon points="50,2 98,28.75 98,86.25 50,113 2,86.25 2,28.75" fill="none" stroke={color} strokeWidth="3" />
        </svg>
      )}
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  );
}

// ---------- Pill ----------
type Tone = 'default' | 'accent' | 'success' | 'warning' | 'error' | 'info' | 'pro' | 'ghost';
export function Pill({ tone = 'default', children, style, title }: { tone?: Tone; children: ReactNode; style?: CSSProperties; title?: string }) {
  const tones: Record<Tone, { bg: string; fg: string; bd: string }> = {
    default: { bg: 'var(--bg-panel)',          fg: 'var(--fg)',         bd: 'var(--border)' },
    accent:  { bg: 'var(--accent)',            fg: '#fff',              bd: 'var(--accent)' },
    success: { bg: 'rgba(101,201,0,.14)',      fg: 'var(--success)',    bd: 'rgba(101,201,0,.4)' },
    warning: { bg: 'rgba(255,220,0,.16)',      fg: '#8a7400',           bd: 'rgba(255,220,0,.5)' },
    error:   { bg: 'rgba(237,0,0,.10)',        fg: 'var(--error)',      bd: 'rgba(237,0,0,.3)' },
    info:    { bg: 'rgba(52,110,244,.10)',     fg: 'var(--link)',       bd: 'rgba(52,110,244,.3)' },
    pro:     { bg: 'var(--prusa-pro-green)',   fg: '#000',              bd: 'var(--prusa-pro-green)' },
    ghost:   { bg: 'transparent',              fg: 'var(--fg-muted)',   bd: 'var(--border)' },
  };
  const t = tones[tone];
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
      letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
      padding: '3px 7px', borderRadius: 'var(--r-xs)',
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
      ...style,
    }}>{children}</span>
  );
}

// ---------- Card ----------
export function Card({ title, eyebrow, action, padding = 18, headerPadding, children, style, className }: {
  title?: ReactNode; eyebrow?: ReactNode; action?: ReactNode; padding?: number;
  headerPadding?: number;
  children: ReactNode; style?: CSSProperties; className?: string;
}) {
  // Header always keeps comfortable horizontal padding even when body padding=0
  // (e.g. table-style cards where rows own their own padding).
  const hPad = headerPadding ?? Math.max(padding, 22);
  return (
    <div className={className} style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', ...style,
    }}>
      {(title || eyebrow || action) && (
        <div style={{ padding: `16px ${hPad}px 12px`, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            {eyebrow && <div className="t-caption" style={{ marginBottom: 6 }}>{eyebrow}</div>}
            {title && <div className="t-card-title">{title}</div>}
          </div>
          {action && <div style={{ flexShrink: 0 }}>{action}</div>}
        </div>
      )}
      <div style={{ padding: `${title || eyebrow ? '10px' : `${padding}px`} ${padding}px ${padding}px`, flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

// ---------- Sparkline ----------
export function Sparkline({ points, color = 'var(--accent)', height = 32, fill = true, strokeWidth = 1.5 }: {
  points: number[]; color?: string; height?: number; fill?: boolean; strokeWidth?: number;
}) {
  if (!points.length) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const w = 100;
  const path = points.map((v, i) => {
    const x = (i / Math.max(1, points.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
  const area = path + ` L ${w} ${height} L 0 ${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
      {fill && <path d={area} fill={color} opacity="0.12" />}
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ---------- Merchant logo bubble ----------
export function MerchantLogo({ name, logo, color, size = 28 }: {
  name?: string; logo?: string; color?: string; size?: number;
}) {
  const initials = logo || (name ? name.split(/\s| - /).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() : '??');
  return (
    <div style={{
      width: size, height: size, borderRadius: 'var(--r-sm)',
      background: color || 'var(--gray-800)', color: '#fff',
      fontFamily: 'var(--font-product)', fontWeight: 700,
      fontSize: size * 0.4, letterSpacing: '0.04em',
      display: 'grid', placeItems: 'center', flexShrink: 0,
      border: '1px solid rgba(0,0,0,0.15)',
    }}>{initials.slice(0, 2)}</div>
  );
}

// ---------- Button ----------
type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';
export function Btn({ variant = 'primary', size = 'md', icon, children, onClick, style, type = 'button', disabled }: {
  variant?: Variant; size?: Size; icon?: ReactNode; children: ReactNode;
  onClick?: MouseEventHandler; style?: CSSProperties; type?: 'button' | 'submit'; disabled?: boolean;
}) {
  // Fixed heights so buttons sitting in the same toolbar always align,
  // regardless of icon/content. 44px on `lg` hits the NN/g + M3 touch target.
  // Horizontal padding only - vertical alignment is via fixed height + line-height: 1.
  const sizes: Record<Size, { height: number; px: number; fs: number }> = {
    sm: { height: 28, px: 12, fs: 11 },
    md: { height: 36, px: 14, fs: 12 },
    lg: { height: 44, px: 18, fs: 13 },
  };
  const variants: Record<Variant, { bg: string; fg: string; bd: string }> = {
    primary: { bg: 'var(--accent)', fg: '#fff', bd: 'var(--accent)' },
    outline: { bg: 'transparent', fg: 'var(--fg-strong)', bd: 'var(--border-strong)' },
    ghost:   { bg: 'transparent', fg: 'var(--fg-strong)', bd: 'transparent' },
    danger:  { bg: 'var(--error)', fg: '#fff', bd: 'var(--error)' },
    success: { bg: 'var(--success)', fg: '#000', bd: 'var(--success)' },
  };
  const s = sizes[size], v = variants[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      fontFamily: 'var(--font-product)', fontWeight: 700,
      fontSize: s.fs, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
      height: s.height, padding: `0 ${s.px}px`, borderRadius: 'var(--r-sm)',
      border: `1px solid ${v.bd}`, background: v.bg, color: v.fg,
      cursor: disabled ? 'not-allowed' : 'pointer', transition: 'var(--dur-fast)',
      opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      lineHeight: 1,
      boxSizing: 'border-box',
      ...style,
    }}>
      {icon && <span style={{ fontSize: s.fs + 2, lineHeight: 1 }}>{icon}</span>}
      {children}
    </button>
  );
}

// ---------- ChipBtn ----------
// Small uppercase pill/chip used everywhere inside modals + tables next to
// content rows (Merge, Disconnect, Reconnect, Clear filter, Apply, …).
// Fixed 28px height keeps these aligned with `<Btn size="sm">`.
type ChipTone = 'default' | 'accent' | 'danger' | 'success';
export function ChipBtn({ tone = 'default', children, onClick, disabled, title, type = 'button', style }: {
  tone?: ChipTone;
  children: ReactNode;
  onClick?: MouseEventHandler;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  style?: CSSProperties;
}) {
  const tones: Record<ChipTone, { fg: string; bd: string; bg: string }> = {
    default: { fg: 'var(--fg-muted)',  bd: 'var(--border)',          bg: 'transparent' },
    accent:  { fg: 'var(--accent)',    bd: 'var(--accent)',          bg: 'rgba(253,80,0,0.10)' },
    danger:  { fg: 'var(--error)',     bd: 'var(--border)',          bg: 'transparent' },
    success: { fg: 'var(--success)',   bd: 'var(--success)',         bg: 'rgba(60,180,90,0.08)' },
  };
  const t = tones[tone];
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} style={{
      fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
      letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
      height: 28, padding: '0 10px', borderRadius: 'var(--r-xs)',
      border: `1px solid ${t.bd}`, background: t.bg, color: t.fg,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
      lineHeight: 1, boxSizing: 'border-box',
      ...style,
    }}>{children}</button>
  );
}

// ---------- ProgressBar ----------
export function ProgressBar({ value, max = 100, color = 'var(--accent)', height = 6, bg = 'var(--bg-panel)', warn = 0.85, danger = 1 }: {
  value: number; max?: number; color?: string; height?: number; bg?: string; warn?: number; danger?: number;
}) {
  const r = Math.min(value / max, 1.2);
  const overflow = r > 1;
  const c = r >= danger ? 'var(--error)' : r >= warn ? 'var(--warning)' : color;
  return (
    <div style={{ position: 'relative', width: '100%', height, background: bg, borderRadius: 'var(--r-xs)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, width: `${Math.min(r, 1) * 100}%`, background: c, transition: 'width 600ms var(--ease-out)' }} />
      {overflow && (
        <div style={{ position: 'absolute', left: '100%', top: 0, height: '100%', width: `${(r - 1) * 100}%`,
          background: 'repeating-linear-gradient(45deg, var(--error) 0 4px, rgba(237,0,0,0.4) 4px 8px)', maxWidth: '20%',
        }} />
      )}
    </div>
  );
}

// ---------- Section header ----------
export function SectionHeader({ eyebrow, title, subtitle, right, big = false }: {
  eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; big?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24, gap: 24, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="t-caption" style={{ color: 'var(--accent)', marginBottom: 10 }}>{eyebrow}</div>}
        <h1 className={big ? 't-h1' : 't-section-title'} style={big ? { margin: 0, textTransform: 'uppercase' } : undefined}>{title}</h1>
        {subtitle && <div className="t-section-subtitle">{subtitle}</div>}
      </div>
      {right && <div className="m3-section-header-right" style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  );
}

// ---------- shared link-button style ----------
export const linkBtn: CSSProperties = {
  background: 'transparent', border: 0, cursor: 'pointer',
  fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
  letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
  color: 'var(--accent)',
};
