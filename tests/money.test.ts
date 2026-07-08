import { describe, it, expect } from "vitest";
import {
  allocate,
  allocateByInts,
  formatCents,
  dollarsToCents,
  centsToDollarString,
} from "@/lib/money";
import { fr } from "@/lib/fraction";
import type { Frac } from "@/lib/types";

// ---- seeded PRNG (inline mulberry32) ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

describe("allocate — largest-remainder rounding", () => {
  it("splits 100 three ways as 34/33/33 (tie → lower index)", () => {
    expect(allocate(100, [fr(1, 3), fr(1, 3), fr(1, 3)])).toEqual([34, 33, 33]);
  });

  it("splits 101 evenly as 51/50", () => {
    expect(allocate(101, [{ n: 1, d: 1 }, { n: 1, d: 1 }])).toEqual([51, 50]);
  });

  it("returns zeros for a zero total (non-degenerate weights)", () => {
    expect(allocate(0, [fr(1, 3), fr(1, 3), fr(1, 3)])).toEqual([0, 0, 0]);
    expect(allocate(0, [{ n: 1, d: 1 }, { n: 1, d: 1 }])).toEqual([0, 0]);
  });

  it("returns [] for empty weights", () => {
    expect(allocate(100, [])).toEqual([]);
    expect(allocate(0, [])).toEqual([]);
  });

  it("puts the whole total on the LAST slot when every weight is zero", () => {
    expect(allocate(100, [{ n: 0, d: 1 }, { n: 0, d: 1 }, { n: 0, d: 1 }])).toEqual([0, 0, 100]);
    expect(allocate(777, [fr(0), fr(0)])).toEqual([0, 777]);
  });

  it("always sums exactly to the input total (spot cases)", () => {
    const cases: Array<{ total: number; weights: Frac[] }> = [
      { total: 100, weights: [fr(1, 3), fr(1, 3), fr(1, 3)] },
      { total: 1400, weights: [fr(1, 3), fr(1, 3), fr(1, 3), fr(0)] },
      { total: 3600, weights: [fr(2, 1), fr(1, 1), fr(0)] },
      { total: 999, weights: [fr(1, 2), fr(1, 3), fr(1, 6)] },
      { total: 1, weights: [fr(1, 1), fr(1, 1), fr(1, 1)] },
    ];
    for (const { total, weights } of cases) {
      const parts = allocate(total, weights);
      expect(parts.reduce((s, x) => s + x, 0)).toBe(total);
      for (const p of parts) expect(Number.isInteger(p)).toBe(true);
    }
  });

  it("supports negative totals, negating a valid non-negative split", () => {
    expect(allocate(-101, [{ n: 1, d: 1 }, { n: 1, d: 1 }])).toEqual([-51, -50]);
    expect(allocate(-100, [fr(1, 3), fr(1, 3), fr(1, 3)]).reduce((s, x) => s + x, 0)).toBe(-100);
  });

  it("throws on negative allocation weights", () => {
    expect(() => allocate(100, [{ n: -1, d: 1 }, { n: 1, d: 1 }])).toThrow();
  });

  it("throws on a non-integer total", () => {
    expect(() => allocate(100.5, [fr(1, 1)])).toThrow();
  });

  it("PROPERTY: results are non-negative integers that sum to the total", () => {
    const rng = mulberry32(0xc0ffee);
    for (let iter = 0; iter < 500; iter++) {
      const total = randInt(rng, 0, 100_000);
      const k = randInt(rng, 1, 8);
      const weights: Frac[] = [];
      for (let i = 0; i < k; i++) weights.push(fr(randInt(rng, 0, 5), randInt(rng, 1, 6)));
      const parts = allocate(total, weights);
      expect(parts.length).toBe(k);
      let sum = 0;
      for (const p of parts) {
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        sum += p;
      }
      expect(sum).toBe(total);
    }
  });
});

describe("allocateByInts", () => {
  it("splits proportionally to integer weights and sums to total", () => {
    const parts = allocateByInts(663, [3267, 2067, 866, 1650]);
    expect(parts.reduce((s, x) => s + x, 0)).toBe(663);
    expect(parts).toEqual([276, 175, 73, 139]);
  });

  it("throws on negative weights", () => {
    expect(() => allocateByInts(100, [-1, 2])).toThrow();
  });

  it("throws on non-integer weights", () => {
    expect(() => allocateByInts(100, [1.5, 2])).toThrow();
  });
});

describe("formatting helpers", () => {
  it("formatCents renders dollars with two-decimal cents", () => {
    expect(formatCents(150)).toBe("$1.50");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(123456)).toBe("$1234.56");
  });

  it("formatCents renders negatives with a leading minus", () => {
    expect(formatCents(-205)).toBe("-$2.05");
  });

  it("dollarsToCents parses currency strings with symbols and separators", () => {
    expect(dollarsToCents("$1,234.56")).toBe(123456);
    expect(dollarsToCents("12.00")).toBe(1200);
    expect(dollarsToCents(12.5)).toBe(1250);
    expect(dollarsToCents("not a number")).toBe(0);
  });

  it("centsToDollarString formats a bare two-decimal string", () => {
    expect(centsToDollarString(150)).toBe("1.50");
    expect(centsToDollarString(10083)).toBe("100.83");
  });
});
