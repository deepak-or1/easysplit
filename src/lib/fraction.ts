import type { Frac } from "./types";

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** Construct a normalized fraction (d > 0, reduced). Throws on d === 0 or non-integers. */
export function fr(n: number, d = 1): Frac {
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    throw new Error(`fraction parts must be integers: ${n}/${d}`);
  }
  if (d === 0) throw new Error("fraction denominator is zero");
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export const F_ZERO: Frac = { n: 0, d: 1 };
export const F_ONE: Frac = { n: 1, d: 1 };

export function fadd(a: Frac, b: Frac): Frac {
  return fr(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function fsub(a: Frac, b: Frac): Frac {
  return fr(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function fmul(a: Frac, b: Frac): Frac {
  return fr(a.n * b.n, a.d * b.d);
}

/** -1 | 0 | 1 — exact comparison via BigInt cross-multiplication. */
export function fcmp(a: Frac, b: Frac): number {
  const left = BigInt(a.n) * BigInt(b.d);
  const right = BigInt(b.n) * BigInt(a.d);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function fIsZero(a: Frac): boolean {
  return a.n === 0;
}

export function fIsNeg(a: Frac): boolean {
  return a.n < 0;
}

export function toNumber(a: Frac): number {
  return a.n / a.d;
}

/** Sum a list of fractions. */
export function fsum(fs: Frac[]): Frac {
  return fs.reduce((acc, f) => fadd(acc, f), F_ZERO);
}

/** Pretty form for UI/notes: 1 → "1", 1/2 → "½", 2 → "2", 3/4 → "¾", else "n/d". */
export function formatFrac(f: Frac): string {
  if (f.d === 1) return String(f.n);
  const vulgar: Record<string, string> = {
    "1/2": "½",
    "1/3": "⅓",
    "2/3": "⅔",
    "1/4": "¼",
    "3/4": "¾",
    "1/5": "⅕",
    "1/6": "⅙",
    "1/8": "⅛",
  };
  const whole = Math.floor(f.n / f.d);
  const rem = f.n - whole * f.d;
  const key = `${rem}/${f.d}`;
  const part = vulgar[key] ?? `${rem}/${f.d}`;
  return whole > 0 ? `${whole}${part}` : part;
}
