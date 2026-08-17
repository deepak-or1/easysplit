import { describe, expect, it } from "vitest";
import { computeSettlement } from "@/lib/split-math";
import { fr } from "@/lib/fraction";
import type { Claim, Frac, Participant, ReceiptItem, Settlement } from "@/lib/types";

/**
 * Birthday mode: a flagged participant pays $0 and their whole share
 * (items + tax + tip) is split evenly across everyone who isn't flagged.
 * The money moves through birthdayAdjustmentCents only — itemsCents,
 * taxCents and tipCents stay as computed, so the receipt still reads true —
 * and the adjustments sum to zero, so the room still reconciles.
 */

function item(id: string, name: string, totalCents: number, sortOrder = 0): ReceiptItem {
  return { id, name, quantity: 1, unitPriceCents: totalCents, totalCents, sharedByAll: false, sortOrder };
}
function person(id: string, isBirthday = false, isHost = false): Participant {
  return {
    id,
    name: id,
    isHost,
    isBirthday,
    paidStatus: "unpaid",
    joinedAt: "2026-01-01T00:00:00.000Z",
  };
}
function claim(itemId: string, participantId: string, share: Frac = fr(1)): Claim {
  return { itemId, participantId, share };
}

const findPerson = (s: Settlement, id: string) => {
  const p = s.people.find((x) => x.participantId === id);
  if (!p) throw new Error(`no person ${id}`);
  return p;
};

/** Σ people + unclaimed === grand, and the adjustments cancel out exactly. */
function expectReconciles(s: Settlement) {
  expect(s.reconciles).toBe(true);
  const sum = s.people.reduce((acc, p) => acc + p.totalCents, 0) + s.unclaimed.totalCents;
  expect(sum).toBe(s.grandTotalCents);
  expect(s.people.reduce((acc, p) => acc + p.birthdayAdjustmentCents, 0)).toBe(0);
}

/**
 * Pasta 2000 → A, Salad 1000 → B, Cake 3000 → C. Tax 601 (deliberately
 * indivisible), tip 20% = 1200. Grand 7801.
 * Before any birthday flag: A 2600, B 1300, C 3901.
 */
const ITEMS = [item("pasta", "Pasta", 2000, 0), item("salad", "Salad", 1000, 1), item("cake", "Cake", 3000, 2)];
const CLAIMS = [claim("pasta", "A"), claim("salad", "B"), claim("cake", "C")];

function settle(participants: Participant[], extra: Partial<{ claims: Claim[] }> = {}): Settlement {
  return computeSettlement({
    items: ITEMS,
    claims: extra.claims ?? CLAIMS,
    participants,
    taxCents: 601,
    tipType: "percent",
    tipValue: 20,
  });
}

describe("birthday mode — baseline (nobody flagged)", () => {
  const s = settle([person("A", false, true), person("B"), person("C")]);

  it("leaves every adjustment at zero and totals untouched", () => {
    expect(s.grandTotalCents).toBe(7801);
    expect(findPerson(s, "A").totalCents).toBe(2600);
    expect(findPerson(s, "B").totalCents).toBe(1300);
    expect(findPerson(s, "C").totalCents).toBe(3901);
    for (const p of s.people) {
      expect(p.birthdayAdjustmentCents).toBe(0);
      expect(p.isBirthday).toBe(false);
    }
    expectReconciles(s);
  });
});

describe("birthday mode — one birthday person among three", () => {
  const s = settle([person("A", false, true), person("B"), person("C", true)]);
  const A = findPerson(s, "A");
  const B = findPerson(s, "B");
  const C = findPerson(s, "C");

  it("zeroes the birthday person's total via the adjustment alone", () => {
    expect(C.isBirthday).toBe(true);
    expect(C.totalCents).toBe(0);
    expect(C.birthdayAdjustmentCents).toBe(-3901);
    // Informational fields survive: the cake is still on Casey's line.
    expect(C.itemsCents).toBe(3000);
    expect(C.taxCents).toBe(301);
    expect(C.tipCents).toBe(600);
    expect(C.lines.map((l) => l.itemId)).toEqual(["cake"]);
  });

  it("splits the covered amount evenly, to the cent (3901 → 1951 + 1950)", () => {
    expect(A.birthdayAdjustmentCents).toBe(1951);
    expect(B.birthdayAdjustmentCents).toBe(1950);
    expect(A.birthdayAdjustmentCents + B.birthdayAdjustmentCents).toBe(3901);
    expect(A.birthdayAdjustmentCents - B.birthdayAdjustmentCents).toBeLessThanOrEqual(1);
  });

  it("raises the other totals by exactly their slice", () => {
    expect(A.totalCents).toBe(2600 + 1951);
    expect(B.totalCents).toBe(1300 + 1950);
    for (const p of [A, B]) {
      expect(p.totalCents).toBe(p.itemsCents + p.taxCents + p.tipCents + p.birthdayAdjustmentCents);
    }
  });

  it("still reconciles", () => {
    expectReconciles(s);
  });
});

describe("birthday mode — two birthday people", () => {
  // A and D pay; B and C are both flagged. D claimed nothing but still helps cover.
  const s = settle([person("A", false, true), person("B", true), person("C", true), person("D")]);
  const A = findPerson(s, "A");
  const D = findPerson(s, "D");

  it("zeroes both birthday people", () => {
    expect(findPerson(s, "B").totalCents).toBe(0);
    expect(findPerson(s, "C").totalCents).toBe(0);
    expect(findPerson(s, "B").birthdayAdjustmentCents).toBe(-1300);
    expect(findPerson(s, "C").birthdayAdjustmentCents).toBe(-3901);
  });

  it("splits the combined 5201 evenly between the two who pay", () => {
    expect(A.birthdayAdjustmentCents).toBe(2601);
    expect(D.birthdayAdjustmentCents).toBe(2600);
    expect(A.totalCents).toBe(2600 + 2601);
    // D owes nothing of their own — the whole bill is the birthday slice.
    expect(D.itemsCents).toBe(0);
    expect(D.totalCents).toBe(2600);
  });

  it("still reconciles", () => {
    expectReconciles(s);
  });
});

describe("birthday mode — everyone flagged is a no-op", () => {
  const s = settle([person("A", true, true), person("B", true), person("C", true)]);

  it("ignores the flags entirely — someone has to pay", () => {
    expect(findPerson(s, "A").totalCents).toBe(2600);
    expect(findPerson(s, "B").totalCents).toBe(1300);
    expect(findPerson(s, "C").totalCents).toBe(3901);
    for (const p of s.people) expect(p.birthdayAdjustmentCents).toBe(0);
    expectReconciles(s);
  });

  it("keeps isBirthday reported as set, so the UI can still explain itself", () => {
    for (const p of s.people) expect(p.isBirthday).toBe(true);
  });
});

describe("birthday mode — a birthday person who claimed nothing", () => {
  // D is flagged but has no items, so no tax/tip share either: nothing to cover.
  const s = settle([person("A", false, true), person("B"), person("C"), person("D", true)]);

  it("covers zero and leaves every other total unchanged", () => {
    const D = findPerson(s, "D");
    expect(D.itemsCents).toBe(0);
    expect(D.taxCents).toBe(0);
    expect(D.tipCents).toBe(0);
    expect(D.totalCents).toBe(0);
    expect(D.birthdayAdjustmentCents).toBe(0);
    expect(Object.is(D.birthdayAdjustmentCents, -0)).toBe(false);

    expect(findPerson(s, "A").totalCents).toBe(2600);
    expect(findPerson(s, "B").totalCents).toBe(1300);
    expect(findPerson(s, "C").totalCents).toBe(3901);
    for (const p of s.people) expect(p.birthdayAdjustmentCents).toBe(0);
    expectReconciles(s);
  });
});

describe("birthday mode — the unclaimed bucket is never touched", () => {
  // Only the pasta is claimed; salad and cake fall to unclaimed.
  const s = settle([person("A", false, true), person("B", true)], {
    claims: [claim("pasta", "A")],
  });

  it("leaves unclaimed out of the redistribution on both sides", () => {
    const before = s.unclaimed.totalCents;
    expect(before).toBeGreaterThan(0);
    // unclaimed has no adjustment field at all — it isn't a person.
    expect("birthdayAdjustmentCents" in s.unclaimed).toBe(false);
    // B claimed nothing, so B's tax/tip share is 0 and nothing is redistributed.
    expect(findPerson(s, "B").totalCents).toBe(0);
    expect(findPerson(s, "A").birthdayAdjustmentCents).toBe(0);
    expectReconciles(s);
  });
});

describe("birthday mode — a single participant flagged alone", () => {
  it("is a no-op: there is nobody left to pay", () => {
    const s = settle([person("A", true, true)], { claims: [claim("pasta", "A")] });
    const A = findPerson(s, "A");
    expect(A.birthdayAdjustmentCents).toBe(0);
    expect(A.totalCents).toBe(A.itemsCents + A.taxCents + A.tipCents);
    expectReconciles(s);
  });
});
