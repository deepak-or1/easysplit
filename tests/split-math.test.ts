import { describe, it, expect } from "vitest";
import { computeSettlement, computeTipCents } from "@/lib/split-math";
import type { SettlementInput } from "@/lib/split-math";
import { fr } from "@/lib/fraction";
import type { Claim, Frac, Participant, ReceiptItem, SettlementLine } from "@/lib/types";

// ---- factories ----
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
  return { id, name, isHost, isBirthday, paidStatus: "unpaid", joinedAt: "2026-01-01T00:00:00.000Z" };
}
function claim(itemId: string, participantId: string, share: Frac): Claim {
  return { itemId, participantId, share };
}

const findPerson = (s: ReturnType<typeof computeSettlement>, id: string) => {
  const p = s.people.find((x) => x.participantId === id);
  if (!p) throw new Error(`no person ${id}`);
  return p;
};
const lineFor = (lines: SettlementLine[], itemId: string) =>
  lines.find((l) => l.itemId === itemId);

// ---- seeded PRNG (inline mulberry32) for the property test ----
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

describe("computeSettlement — canonical scenario (ground truth)", () => {
  const items = [
    item("nachos", "Nachos", 1, 1400, 1400, false, 0),
    item("marg", "Margarita", 3, 1200, 3600, false, 1),
    item("queso", "Queso", 1, 1200, 1200, true, 2),
    item("burger", "Burger", 1, 1650, 1650, false, 3),
  ];
  const participants = [person("A", "Alex", true), person("B", "Bailey"), person("C", "Casey")];
  const claims: Claim[] = [
    claim("nachos", "A", fr(1, 3)),
    claim("nachos", "B", fr(1, 3)),
    claim("nachos", "C", fr(1, 3)),
    claim("marg", "A", fr(2, 1)),
    claim("marg", "B", fr(1, 1)),
  ];
  const input: SettlementInput = {
    items,
    claims,
    participants,
    taxCents: 663,
    tipType: "percent",
    tipValue: 20,
  };
  const s = computeSettlement(input);

  it("computes the receipt-level totals", () => {
    expect(s.subtotalCents).toBe(7850);
    expect(s.tipCents).toBe(1570);
    expect(s.grandTotalCents).toBe(10083);
  });

  it("settles person A", () => {
    const A = findPerson(s, "A");
    expect(A.itemsCents).toBe(3267);
    expect(A.taxCents).toBe(276);
    expect(A.tipCents).toBe(654);
    expect(A.totalCents).toBe(4197);
  });

  it("settles person B", () => {
    const B = findPerson(s, "B");
    expect(B.itemsCents).toBe(2067);
    expect(B.taxCents).toBe(175);
    expect(B.tipCents).toBe(413);
    expect(B.totalCents).toBe(2655);
  });

  it("settles person C", () => {
    const C = findPerson(s, "C");
    expect(C.itemsCents).toBe(866);
    expect(C.taxCents).toBe(73);
    expect(C.tipCents).toBe(173);
    expect(C.totalCents).toBe(1112);
  });

  it("settles the unclaimed bucket (the unclaimed burger)", () => {
    expect(s.unclaimed.itemsCents).toBe(1650);
    expect(s.unclaimed.totalCents).toBe(2119);
  });

  it("reconciles exactly", () => {
    expect(s.reconciles).toBe(true);
    const sum = s.people.reduce((acc, p) => acc + p.totalCents, 0) + s.unclaimed.totalCents;
    expect(sum).toBe(s.grandTotalCents);
  });

  it("allocates the nachos 467/467/466 across A/B/C", () => {
    expect(lineFor(findPerson(s, "A").lines, "nachos")!.amountCents).toBe(467);
    expect(lineFor(findPerson(s, "B").lines, "nachos")!.amountCents).toBe(467);
    expect(lineFor(findPerson(s, "C").lines, "nachos")!.amountCents).toBe(466);
  });

  it("labels fractional and multi-unit lines", () => {
    const A = findPerson(s, "A");
    expect(lineFor(A.lines, "nachos")!.label).toBe("Nachos (⅓)");
    expect(lineFor(A.lines, "marg")!.label).toBe("Margarita ×2");
  });
});

describe("computeSettlement — edge cases", () => {
  it("sharedByAll with zero participants is fully unclaimed", () => {
    const s = computeSettlement({
      items: [item("q", "Queso", 1, 1200, 1200, true, 0)],
      claims: [],
      participants: [],
      taxCents: 100,
      tipType: "percent",
      tipValue: 20,
    });
    expect(s.people).toEqual([]);
    expect(s.unclaimed.itemsCents).toBe(1200);
    // all tax/tip land on the unclaimed bucket too
    expect(s.unclaimed.totalCents).toBe(s.grandTotalCents);
    expect(s.reconciles).toBe(true);
  });

  it("tipType 'amount' uses tipValue as cents verbatim", () => {
    expect(computeTipCents(5000, "amount", 1500)).toBe(1500);
    const s = computeSettlement({
      items: [item("x", "Thing", 1, 5000, 5000, false, 0)],
      claims: [],
      participants: [person("A", "Alex", true)],
      taxCents: 0,
      tipType: "amount",
      tipValue: 1500,
    });
    expect(s.tipCents).toBe(1500);
    expect(s.grandTotalCents).toBe(6500);
    expect(s.reconciles).toBe(true);
  });

  it("subtotal 0 yields grand 0 with no NaN anywhere", () => {
    const s = computeSettlement({
      items: [],
      claims: [],
      participants: [person("A", "Alex", true)],
      taxCents: 0,
      tipType: "percent",
      tipValue: 20,
    });
    expect(s.subtotalCents).toBe(0);
    expect(s.tipCents).toBe(0);
    expect(s.grandTotalCents).toBe(0);
    expect(s.reconciles).toBe(true);
    expect(Number.isFinite(s.claimedRatio)).toBe(true);
    for (const p of s.people) {
      expect(Number.isFinite(p.totalCents)).toBe(true);
      expect(Number.isFinite(p.taxCents)).toBe(true);
      expect(Number.isFinite(p.tipCents)).toBe(true);
    }
    expect(Number.isFinite(s.unclaimed.totalCents)).toBe(true);
  });

  it("claimedRatio is 1 when everything is claimed", () => {
    const s = computeSettlement({
      items: [item("x", "Thing", 1, 5000, 5000, false, 0)],
      claims: [claim("x", "A", fr(1, 1))],
      participants: [person("A", "Alex", true)],
      taxCents: 0,
      tipType: "percent",
      tipValue: 0,
    });
    expect(s.claimedRatio).toBe(1);
  });

  it("claimedRatio is 0 when nothing is claimed", () => {
    const s = computeSettlement({
      items: [item("x", "Thing", 1, 5000, 5000, false, 0)],
      claims: [],
      participants: [person("A", "Alex", true)],
      taxCents: 0,
      tipType: "percent",
      tipValue: 0,
    });
    expect(s.claimedRatio).toBe(0);
  });
});

describe("computeSettlement — PROPERTY (200 seeded random scenarios)", () => {
  it("always reconciles with non-negative integer allocations", () => {
    const rng = mulberry32(0x5e77_1e);
    const shares: Frac[] = [fr(1, 1), fr(1, 2), fr(1, 3), fr(2, 3), fr(2, 1), fr(3, 1)];

    for (let scenario = 0; scenario < 200; scenario++) {
      const nItems = randInt(rng, 1, 12);
      const nPeople = randInt(rng, 1, 6);
      const participants: Participant[] = [];
      for (let i = 0; i < nPeople; i++) participants.push(person(`p${i}`, `P${i}`, i === 0));

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

      const s = computeSettlement({ items, claims, participants, taxCents, tipType, tipValue });

      // reconciles flag AND independent sum check
      expect(s.reconciles).toBe(true);
      const sum = s.people.reduce((acc, p) => acc + p.totalCents, 0) + s.unclaimed.totalCents;
      expect(sum).toBe(s.grandTotalCents);

      // every allocation is a non-negative integer
      const nums: number[] = [];
      for (const p of s.people) {
        nums.push(p.itemsCents, p.taxCents, p.tipCents, p.totalCents);
        for (const l of p.lines) nums.push(l.amountCents);
      }
      nums.push(
        s.unclaimed.itemsCents,
        s.unclaimed.taxCents,
        s.unclaimed.tipCents,
        s.unclaimed.totalCents,
      );
      for (const l of s.unclaimed.lines) nums.push(l.amountCents);
      for (const n of nums) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("computeSettlement — PROPERTY with birthday flags (200 seeded scenarios)", () => {
  it("always reconciles, and every non-birthday total stays a non-negative integer", () => {
    const rng = mulberry32(0xb1_47_da);
    const shares: Frac[] = [fr(1, 1), fr(1, 2), fr(1, 3), fr(2, 3), fr(2, 1), fr(3, 1)];

    for (let scenario = 0; scenario < 200; scenario++) {
      const nItems = randInt(rng, 1, 12);
      const nPeople = randInt(rng, 1, 6);
      const participants: Participant[] = [];
      for (let i = 0; i < nPeople; i++) {
        // ~30% flagged, so all-birthday rooms (the no-op path) come up too.
        participants.push(person(`p${i}`, `P${i}`, i === 0, rng() < 0.3));
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

      const s = computeSettlement({ items, claims, participants, taxCents, tipType, tipValue });

      // The invariant birthday mode must never break.
      expect(s.reconciles).toBe(true);
      const sum = s.people.reduce((acc, p) => acc + p.totalCents, 0) + s.unclaimed.totalCents;
      expect(sum).toBe(s.grandTotalCents);

      // Adjustments are a pure transfer: they cancel exactly.
      expect(s.people.reduce((acc, p) => acc + p.birthdayAdjustmentCents, 0)).toBe(0);

      const anyContributor = s.people.some((p) => !p.isBirthday);
      for (const p of s.people) {
        expect(Number.isInteger(p.birthdayAdjustmentCents)).toBe(true);
        expect(p.totalCents).toBe(
          p.itemsCents + p.taxCents + p.tipCents + p.birthdayAdjustmentCents,
        );
        if (p.isBirthday && anyContributor) {
          // Flagged, and someone is left to pay: they owe nothing, because the
          // adjustment cancels their share exactly.
          expect(p.totalCents).toBe(0);
          expect(p.birthdayAdjustmentCents + p.itemsCents + p.taxCents + p.tipCents).toBe(0);
        } else {
          expect(Number.isInteger(p.totalCents)).toBe(true);
          expect(p.totalCents).toBeGreaterThanOrEqual(0);
        }
      }

      // With no one left to pay, the flags are ignored outright.
      if (!anyContributor) {
        for (const p of s.people) expect(p.birthdayAdjustmentCents).toBe(0);
      }
    }
  });
});
