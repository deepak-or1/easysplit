import type { Frac } from "./types";

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function dollarsToCents(input: string | number): number {
  const n = typeof input === "string" ? parseFloat(input.replace(/[$,\s]/g, "")) : input;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function centsToDollarString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Largest-remainder allocation: split `totalCents` across `weights`
 * (exact rationals) so results are integers and sum EXACTLY to totalCents.
 *
 * exact_i = totalCents * w_i / W, floored; leftover cents go to the largest
 * fractional remainders (ties broken by lower index — deterministic).
 *
 * Degenerate case: if every weight is zero (or the list is empty), the whole
 * amount goes to the LAST slot. Callers put the "unclaimed" bucket last so
 * unallocatable money lands there rather than vanishing.
 */
export function allocate(totalCents: number, weights: Frac[]): number[] {
  if (!Number.isInteger(totalCents)) throw new Error("totalCents must be an integer");
  if (weights.length === 0) return [];
  if (weights.some((w) => w.n < 0)) throw new Error("negative allocation weight");

  // W = Σ weights, as a rational over a BigInt common product to avoid overflow.
  // W = Wn/Wd where Wd = Π d_i and Wn = Σ n_i * (Wd / d_i)
  let Wd = 1n;
  for (const w of weights) Wd *= BigInt(w.d);
  let Wn = 0n;
  for (const w of weights) Wn += BigInt(w.n) * (Wd / BigInt(w.d));

  if (Wn === 0n) {
    const out = new Array<number>(weights.length).fill(0);
    out[out.length - 1] = totalCents;
    return out;
  }

  const negative = totalCents < 0;
  const T = BigInt(Math.abs(totalCents));

  // exact_i = T * n_i * (Wd/d_i) / Wn  — numerator Ni over denominator Wn
  const floors: number[] = [];
  const rems: bigint[] = []; // remainder numerators, all over common denominator Wn
  let allocated = 0n;
  for (const w of weights) {
    const Ni = T * BigInt(w.n) * (Wd / BigInt(w.d));
    const q = Ni / Wn;
    floors.push(Number(q));
    rems.push(Ni % Wn);
    allocated += q;
  }

  const leftover = Number(T - allocated);
  // Order indices by remainder desc, index asc.
  const order = rems
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; k < leftover; k++) floors[order[k].i] += 1;

  return negative ? floors.map((x) => -x) : floors;
}

/** Convenience: allocate proportionally to integer weights (e.g. per-person item subtotals). */
export function allocateByInts(totalCents: number, weights: number[]): number[] {
  return allocate(
    totalCents,
    weights.map((w) => {
      if (!Number.isInteger(w) || w < 0) throw new Error("weights must be non-negative integers");
      return { n: w, d: 1 };
    }),
  );
}
