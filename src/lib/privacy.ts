// Pure helpers for Privacy Mode. The auto-tagger in Shell.tsx imports
// `maskCurrency` so the masking logic stays unit-testable and consistent
// across any future surface (server-side renders, exports, screenshots).

/** Currency-pattern detector: $, €, £, or ¥ followed by an optional space
 *  and a digit (with optional sign). Mirrors the auto-tagger's intent. */
export const CURRENCY_RE = /[$€£¥]\s?-?\+?\d/;

/** Replace every digit inside a currency-shaped substring with `X`,
 *  preserving the symbol, sign, commas, and decimal. Idempotent: once
 *  the digits are gone the regex no longer matches, so re-running is a
 *  no-op. Used by the privacy auto-tagger and tested in
 *  tests/privacy.test.ts. */
export function maskCurrency(text: string): string {
  return text.replace(
    /([$€£¥])(\s?)(-?\+?\d[\d,]*\.?\d*)/g,
    (_m, sym, sp, num) => sym + sp + (num as string).replace(/\d/g, 'X'),
  );
}
