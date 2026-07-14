'use client';
import { useState, useEffect, useRef, CSSProperties } from 'react';
import { fmt } from './atoms';

export function useCountTo(target: number, ms = 900): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

export function Counter({ value, format = (v: number) => fmt(v), className, style }: {
  value: number; format?: (v: number) => string; className?: string; style?: CSSProperties;
}) {
  const v = useCountTo(value);
  return <span className={className} style={style}>{format(v)}</span>;
}
