import { describe, expect, it } from "vitest";
import { computeDiscountCents, computeSettlement } from "@/lib/split-math";
import { fr } from "@/lib/fraction";
import type { Claim, Frac, Participant, ReceiptItem } from "@/lib/types";

/**
 * Whole-bill discounts. The discount mirrors the tip machinery exactly, but
 * subtracts: same buckets, same weights, same largest-remainder allocation —
 * so the one invariant that must never break (Σ people + unclaimed === grand
 * total, to the cent) survives every shape of discount, including the ones
 * that take the bill all the way to zero.
 */

function item(
  id: string,
  name: string,
  quantity: number,
  unitPriceCents: number,
  totalCents: number,
  sharedByAll = false,
  sortOrder = 0,
): ReceiptItem {
  return { id, name, quantity, unitPriceCents, totalCents, sharedByAll, sortOrder };
}
function person(id: string, name: string, isHost = false, isBirthday = false): Participant {
  return {
    id,
    name,
    isHost,
    isBirthday,
    paidStatus: "unpaid",
    joinedAt: "2026-01-01T00:00:00.000Z",
  };
}
function claim(itemId: string, participantId: string, share: Frac): Claim {
  return { itemId, participantId, share };
}
const findPerson = (s: ReturnType<typeof computeSettlement>, id: string) => {
  const p = s.people.find((x) => x.participantId === id);
  if (!p) throw new Error(`no person ${id}`);
  return p;
};
const sumOf = (s: ReturnType<typeof computeSettlement>) =>
  s.people.reduce((acc, p) => acc + p.totalCents, 0) + s.unclaimed.totalCents;

describe("computeDiscountCents", () => {
  it("is 0 when there is no discount, whatever the value says", () => {
    expect(computeDiscountCents(10_000, null, 0)).toBe(0);
    expect(computeDiscountCents(10_000, null, 5_000)).toBe(0);
  });

  it("takes a percent of the subtotal, rounded to the cent", () => {
    expect(computeDiscountCents(10_000, "percent", 15)).toBe(1500);
    // 3333 × 15% = 499.95 → 500
    expect(computeDiscountCents(3333, "percent", 15)).toBe(500);
    // 3333 × 12.5% = 416.625 → 417
    expect(computeDiscountCents(3333, "percent", 12.5)).toBe(417);
  });

  it("takes an amount verbatim, rounded to the cent", () => {
    expect(computeDiscountCents(10_000, "amount", 450)).toBe(450);
    expect(computeDiscountCents(10_000, "amount", 450.4)).toBe(450);
  });

  it("clamps an amount larger than the subtotal down to the subtotal", () => {
    // The API accepts this on purpose — the items can change later.
    expect(computeDiscountCents(2_000, "amount", 5_000)).toBe(2000);
    expect(computeDiscountCents(0, "amount", 5_000)).toBe(0);
  });

  it("clamps a percent over 100 and floors a negative value at 0", () => {
    expect(computeDiscountCents(2_000, "percent", 150)).toBe(2000);
    expect(computeDiscountCents(2_000, "percent", -10)).toBe(0);
    expect(computeDiscountCents(2_000, "amount", -500)).toBe(0);
  });

  it("is 0 on a zero subtotal", () => {
    expect(computeDiscountCents(0, "percent", 15)).toBe(0);
    expect(computeDiscountCents(0, "amount", 0)).toBe(0);
  });
});

describe("computeSettlement — percent discount", () => {
  // Two people, everything claimed: A owes 6000 of items, B owes 4000.
  const base = {
    items: [item("a", "Steak", 1, 6000, 6000, false, 0), item("b", "Pasta", 1, 4000, 4000, false, 1)],
    claims: [claim("a", "A", fr(1)), claim("b", "B", fr(1))],
    participants: [person("A", "Alex", true), person("B", "Bailey")],
    taxCents: 800,
    tipType: "percent" as const,
    tipValue: 20,
  };

  const s = computeSettlement({ ...base, discountType: "percent", discountValue: 15 });

  it("computes the receipt-level totals with the discount subtracted", () => {
    expect(s.subtotalCents).toBe(10_000);
    // The tip is deliberately on the PRE-discount subtotal.
    expect(s.tipCents).toBe(2000);
    expect(s.discountCents).toBe(1500);
    expect(s.grandTotalCents).toBe(10_000 + 800 + 2000 - 1500);
  });

  it("allocates the discount proportionally to what each person ordered", () => {
    expect(findPerson(s, "A").discountCents).toBe(900); // 60% of 1500
    expect(findPerson(s, "B").discountCents).toBe(600); // 40% of 1500
  });

  it("subtracts each person's share from their total", () => {
    const A = findPerson(s, "A");
    expect(A.totalCents).toBe(A.itemsCents + A.taxCents + A.tipCents - A.discountCents);
    const B = findPerson(s, "B");
    expect(B.totalCents).toBe(B.itemsCents + B.taxCents + B.tipCents - B.discountCents);
  });

  it("reconciles exactly", () => {
    expect(s.reconciles).toBe(true);
    expect(sumOf(s)).toBe(s.grandTotalCents);
  });

  it("splits an odd percent to the cent, with nothing stranded", () => {
    // 10,000 × 7% = 700, across 6000/4000 weights → 420 / 280.
    const odd = computeSettlement({ ...base, discountType: "percent", discountValue: 7 });
    expect(odd.discountCents).toBe(700);
    expect(findPerson(odd, "A").discountCents + findPerson(odd, "B").discountCents).toBe(700);
    expect(odd.reconciles).toBe(true);
    expect(sumOf(odd)).toBe(odd.grandTotalCents);
  });

  it("splits an indivisible discount by largest remainder, summing exactly", () => {
    // 3 people on a 1000¢ item, 1¢ of discount: someone gets it, nobody twice.
    const three = computeSettlement({
      items: [item("x", "Thing", 3, 1000, 3000, false, 0)],
      claims: [claim("x", "A", fr(1)), claim("x", "B", fr(1)), claim("x", "C", fr(1))],
      participants: [person("A", "Alex", true), person("B", "Bailey"), person("C", "Casey")],
      taxCents: 0,
      tipType: "percent",
      tipValue: 0,
      discountType: "amount",
      discountValue: 1,
    });
    expect(three.discountCents).toBe(1);
    expect(three.people.reduce((acc, p) => acc + p.discountCents, 0)).toBe(1);
    expect(three.reconciles).toBe(true);
    expect(sumOf(three)).toBe(three.grandTotalCents);
  });
});

describe("computeSettlement — amount discount", () => {
  const input = {
    items: [item("a", "Steak", 1, 6000, 6000, false, 0), item("b", "Pasta", 1, 4000, 4000, false, 1)],
    claims: [claim("a", "A", fr(1)), claim("b", "B", fr(1))],
    participants: [person("A", "Alex", true), person("B", "Bailey")],
    taxCents: 800,
    tipType: "amount" as const,
    tipValue: 2000,
  };

  it("subtracts a flat amount and reconciles", () => {
    const s = computeSettlement({ ...input, discountType: "amount", discountValue: 2500 });
    expect(s.discountCents).toBe(2500);
    expect(s.grandTotalCents).toBe(10_000 + 800 + 2000 - 2500);
    expect(findPerson(s, "A").discountCents).toBe(1500);
    expect(findPerson(s, "B").discountCents).toBe(1000);
    expect(s.reconciles).toBe(true);
    expect(sumOf(s)).toBe(s.grandTotalCents);
  });

  it("clamps an amount bigger than the subtotal to the subtotal", () => {
    const s = computeSettlement({ ...input, discountType: "amount", discountValue: 99_999 });
    expect(s.discountCents).toBe(10_000);
    // Items are entirely comped; tax and tip are still owed.
    expect(s.grandTotalCents).toBe(800 + 2000);
    expect(s.reconciles).toBe(true);
    expect(sumOf(s)).toBe(s.grandTotalCents);
    for (const p of s.people) expect(p.totalCents).toBeGreaterThanOrEqual(0);
  });

  it("stays at 0 on an empty receipt, with no NaN anywhere", () => {
    const s = computeSettlement({
      items: [],
      claims: [],
      participants: [person("A", "Alex", true)],
      taxCents: 0,
      tipType: "percent",
      tipValue: 20,
      discountType: "amount",
      discountValue: 5000,
    });
    expect(s.subtotalCents).toBe(0);
    expect(s.discountCents).toBe(0);
    expect(s.grandTotalCents).toBe(0);
    expect(s.reconciles).toBe(true);
    for (const p of s.people) {
      expect(Number.isFinite(p.discountCents)).toBe(true);
      expect(p.totalCents).toBe(0);
    }
    expect(Number.isFinite(s.unclaimed.discountCents)).toBe(true);
  });

  it("defaults to no discount when the fields are omitted entirely", () => {
    const s = computeSettlement(input);
    expect(s.discountCents).toBe(0);
    for (const p of s.people) expect(p.discountCents).toBe(0);
    expect(s.unclaimed.discountCents).toBe(0);
    expect(s.grandTotalCents).toBe(10_000 + 800 + 2000);
    expect(s.reconciles).toBe(true);
  });
});

describe("computeSettlement — discount with an unclaimed bucket", () => {
  it("gives the unclaimed remainder its share, and still reconciles", () => {
    const s = computeSettlement({
      // A claims the 6000 steak; the 4000 pasta is nobody's.
      items: [
        item("a", "Steak", 1, 6000, 6000, false, 0),
        item("b", "Pasta", 1, 4000, 4000, false, 1),
      ],
      claims: [claim("a", "A", fr(1))],
      participants: [person("A", "Alex", true)],
      taxCents: 800,
      tipType: "percent",
      tipValue: 20,
      discountType: "percent",
      discountValue: 15,
    });

    expect(s.discountCents).toBe(1500);
    expect(findPerson(s, "A").discountCents).toBe(900);
    expect(s.unclaimed.itemsCents).toBe(4000);
    expect(s.unclaimed.discountCents).toBe(600);
    expect(s.unclaimed.totalCents).toBe(
      s.unclaimed.itemsCents + s.unclaimed.taxCents + s.unclaimed.tipCents - 600,
    );
    expect(s.reconciles).toBe(true);
    expect(sumOf(s)).toBe(s.grandTotalCents);
  });

  it("lands the whole discount on the unclaimed bucket when nobody has claimed anything", () => {
    const s = computeSettlement({
      items: [item("a", "Steak", 1, 6000, 6000, false, 0)],
      claims: [],
      participants: [person("A", "Alex", true)],
      taxCents: 0,
      tipType: "percent",
      tipValue: 0,
      discountType: "percent",
      discountValue: 50,
    });
    expect(findPerson(s, "A").discountCents).toBe(0);
    expect(s.unclaimed.discountCents).toBe(3000);
    expect(s.unclaimed.totalCents).toBe(3000);
    expect(s.reconciles).toBe(true);
    expect(sumOf(s)).toBe(s.grandTotalCents);
  });
});

describe("computeSettlement — discount meets birthday mode", () => {
  it("covers the celebrant's POST-discount share, and everyone still reconciles", () => {
    const s = computeSettlement({
      items: [
        item("a", "Steak", 1, 6000, 6000, false, 0),
        item("b", "Pasta", 1, 4000, 4000, false, 1),
      ],
      claims: [claim("a", "A", fr(1)), claim("b", "B", fr(1))],
      // B is the birthday person: their 4000 of items carries 600 of discount.
      participants: [person("A", "Alex", true), person("B", "Bailey", false, true)],
      taxCents: 800,
      tipType: "percent",
      tipValue: 20,
      discountType: "percent",
      discountValue: 15,
    });

    const B = findPerson(s, "B");
    expect(B.discountCents).toBe(600);
    // Covered on what they'd have owed AFTER the discount, not before.
    expect(B.birthdayAdjustmentCents).toBe(-(B.itemsCents + B.taxCents + B.tipCents - 600));
    expect(B.totalCents).toBe(0);

    const A = findPerson(s, "A");
    expect(A.birthdayAdjustmentCents).toBe(-B.birthdayAdjustmentCents);
    expect(A.totalCents).toBe(
      A.itemsCents + A.taxCents + A.tipCents - A.discountCents + A.birthdayAdjustmentCents,
    );

    expect(s.people.reduce((acc, p) => acc + p.birthdayAdjustmentCents, 0)).toBe(0);
    expect(s.reconciles).toBe(true);
    expect(sumOf(s)).toBe(s.grandTotalCents);
  });

  it("keeps the celebrant's adjustment at exactly 0 (never −0) on a fully comped bill", () => {
    const s = computeSettlement({
      items: [item("a", "Steak", 1, 6000, 6000, false, 0)],
      claims: [claim("a", "B", fr(1))],
      participants: [person("A", "Alex", true), person("B", "Bailey", false, true)],
      taxCents: 0,
      tipType: "percent",
      tipValue: 0,
      // 100% off: the celebrant's post-discount share is exactly 0.
      discountType: "percent",
      discountValue: 100,
    });

    const B = findPerson(s, "B");
    expect(B.itemsCents).toBe(6000);
    expect(B.discountCents).toBe(6000);
    expect(Object.is(B.birthdayAdjustmentCents, 0)).toBe(true);
    expect(B.totalCents).toBe(0);
    expect(findPerson(s, "A").birthdayAdjustmentCents).toBe(0);
    expect(s.reconciles).toBe(true);
    expect(sumOf(s)).toBe(s.grandTotalCents);
  });
});

describe("computeSettlement — full comp", () => {
  it("zeroes the bill when the discount equals the subtotal, with nothing negative", () => {
    const s = computeSettlement({
      items: [
        item("a", "Steak", 1, 6000, 6000, false, 0),
        item("b", "Pasta", 3, 1333, 3999, false, 1),
      ],
      claims: [claim("a", "A", fr(1)), claim("b", "B", fr(2)), claim("b", "C", fr(1))],
      participants: [person("A", "Alex", true), person("B", "Bailey"), person("C", "Casey")],
      taxCents: 0,
      tipType: "percent",
      tipValue: 0,
      discountType: "amount",
      discountValue: 9999, // exactly the subtotal
    });

    expect(s.subtotalCents).toBe(9999);
    expect(s.discountCents).toBe(9999);
    expect(s.grandTotalCents).toBe(0);
    for (const p of s.people) {
      // Each person's share of the discount is exactly what they ordered.
      expect(p.discountCents).toBe(p.itemsCents);
      expect(p.totalCents).toBe(0);
      expect(p.totalCents).toBeGreaterThanOrEqual(0);
    }
    expect(s.unclaimed.totalCents).toBe(0);
    expect(s.reconciles).toBe(true);
    expect(sumOf(s)).toBe(0);
  });

  it("still collects tax and tip on a 100%-off bill", () => {
    const s = computeSettlement({
      items: [item("a", "Steak", 1, 6000, 6000, false, 0)],
      claims: [claim("a", "A", fr(1))],
      participants: [person("A", "Alex", true)],
      taxCents: 500,
      tipType: "percent",
      tipValue: 20,
      discountType: "percent",
      discountValue: 100,
    });
    expect(s.discountCents).toBe(6000);
    // Tip is 20% of the PRE-discount subtotal — 1200, not 0.
    expect(s.tipCents).toBe(1200);
    expect(s.grandTotalCents).toBe(1700);
    expect(findPerson(s, "A").totalCents).toBe(1700);
    expect(s.reconciles).toBe(true);
    expect(sumOf(s)).toBe(s.grandTotalCents);
  });
});

describe("computeSettlement — PROPERTY with discounts (200 seeded scenarios)", () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const randInt = (rng: () => number, min: number, max: number) =>
    min + Math.floor(rng() * (max - min + 1));

  it("always reconciles, and nobody's discount share exceeds what they ordered", () => {
    const rng = mulberry32(0xd15c_07);
    const shares: Frac[] = [fr(1, 1), fr(1, 2), fr(1, 3), fr(2, 3), fr(2, 1), fr(3, 1)];

    for (let scenario = 0; scenario < 200; scenario++) {
      const nItems = randInt(rng, 1, 10);
      const nPeople = randInt(rng, 1, 5);
      const participants: Participant[] = [];
      for (let i = 0; i < nPeople; i++) {
        participants.push(person(`p${i}`, `P${i}`, i === 0, rng() < 0.2));
      }

      const items: ReceiptItem[] = [];
      const claims: Claim[] = [];
      for (let i = 0; i < nItems; i++) {
        const qty = randInt(rng, 1, 4);
        const unit = randInt(rng, 1, 5000);
        const shared = rng() < 0.2;
        const id = `i${i}`;
        items.push(item(id, `Item ${i}`, qty, unit, unit * qty, shared, i));
        if (!shared) {
          for (const p of participants) {
            if (rng() < 0.5) {
              claims.push(claim(id, p.id, shares[randInt(rng, 0, shares.length - 1)]));
            }
          }
        }
      }

      const taxCents = randInt(rng, 0, 3000);
      const tipType = rng() < 0.5 ? "percent" : "amount";
      const tipValue = tipType === "percent" ? randInt(rng, 0, 30) : randInt(rng, 0, 4000);
      // A third of the runs carry no discount at all; the rest lean hard,
      // including amounts far past the subtotal so the clamp gets exercised.
      const roll = rng();
      const discountType = roll < 0.33 ? null : roll < 0.66 ? "percent" : "amount";
      // Percents draw in half-point steps (0…100): a 12.5% coupon is a real
      // thing, and a fractional percent has to round to the cent and reconcile
      // exactly like a whole one.
      const discountValue =
        discountType === "percent" ? randInt(rng, 0, 200) / 2 : randInt(rng, 0, 200_000);

      const s = computeSettlement({
        items,
        claims,
        participants,
        taxCents,
        tipType,
        tipValue,
        discountType,
        discountValue,
      });

      expect(s.reconciles).toBe(true);
      expect(sumOf(s)).toBe(s.grandTotalCents);
      expect(s.grandTotalCents).toBe(s.subtotalCents + taxCents + s.tipCents - s.discountCents);
      // Never more discount than there were items to discount.
      expect(s.discountCents).toBeLessThanOrEqual(s.subtotalCents);
      expect(s.discountCents).toBeGreaterThanOrEqual(0);
      // The shares add up to the whole discount, and none of them overshoots
      // its bucket — which is what keeps every total non-negative.
      const shareSum =
        s.people.reduce((acc, p) => acc + p.discountCents, 0) + s.unclaimed.discountCents;
      expect(shareSum).toBe(s.discountCents);
      for (const p of s.people) {
        expect(Number.isInteger(p.discountCents)).toBe(true);
        expect(p.discountCents).toBeGreaterThanOrEqual(0);
        expect(p.discountCents).toBeLessThanOrEqual(p.itemsCents);
        expect(p.totalCents).toBe(
          p.itemsCents + p.taxCents + p.tipCents - p.discountCents + p.birthdayAdjustmentCents,
        );
        if (!p.isBirthday || !s.people.some((x) => !x.isBirthday)) {
          expect(p.totalCents).toBeGreaterThanOrEqual(0);
        }
      }
      expect(s.unclaimed.discountCents).toBeLessThanOrEqual(s.unclaimed.itemsCents);
      expect(s.unclaimed.totalCents).toBeGreaterThanOrEqual(0);
    }
  });
});
