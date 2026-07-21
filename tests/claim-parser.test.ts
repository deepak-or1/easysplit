import { describe, it, expect } from "vitest";
import { parseClaimMessage } from "@/lib/claim-parser/parser";
import type { ParseContext } from "@/lib/claim-parser/types";
import { DEMO_RECEIPT } from "@/lib/demo-receipt";
import type { ClaimAction, Participant, ReceiptItem } from "@/lib/types";

// ---- fixtures ----
// Build ctx items from the demo receipt, giving them stable ids i1..i8.
const items: ReceiptItem[] = DEMO_RECEIPT.items.map((it, i) => ({
  id: `i${i + 1}`,
  name: it.name,
  quantity: it.quantity,
  unitPriceCents: it.unitPriceCents,
  totalCents: it.totalCents,
  sharedByAll: false,
  sortOrder: i,
}));
// i1 Queso Fundido, i2 Nachos Grande, i3 Smash Burger, i4 Truffle Fries,
// i5 Tacos al Pastor, i6 Margarita, i7 Hazy IPA, i8 Mexican Coke

function person(id: string, name: string, isHost = false): Participant {
  return { id, name, isHost, paidStatus: "unpaid", joinedAt: "2026-01-01T00:00:00.000Z" };
}
const deepak = person("p_deepak", "Deepak", true); // self
const alex = person("p_alex", "Alex");
const maya = person("p_maya", "Maya");
const sam = person("p_sam", "Sam");
const participants = [deepak, alex, maya, sam];

function parse(message: string, opts?: { items?: ReceiptItem[] }) {
  const ctx: ParseContext = {
    self: deepak,
    items: opts?.items ?? items,
    participants,
    selfClaims: [],
  };
  return parseClaimMessage(message, ctx);
}

const setAction = (itemId: string, n: number, d: number, pid = deepak.id): ClaimAction => ({
  type: "set",
  itemId,
  participantId: pid,
  share: { n, d },
});

describe("claim parser — CONTRACTS table rows", () => {
  it('"I had the burger" -> set self Burger 1/1', () => {
    const r = parse("I had the burger");
    expect(r.clarification).toBeUndefined();
    expect(r.actions).toEqual([setAction("i3", 1, 1)]);
  });

  it('"I had burger and fries" -> two set actions, 1 each', () => {
    const r = parse("I had burger and fries");
    expect(r.clarification).toBeUndefined();
    expect(r.actions).toEqual([setAction("i3", 1, 1), setAction("i4", 1, 1)]);
  });

  it('"half the nachos" -> set share 1/2', () => {
    const r = parse("half the nachos");
    expect(r.actions).toEqual([setAction("i2", 1, 2)]);
  });

  it('"I had half the fries" -> set share 1/2', () => {
    const r = parse("I had half the fries");
    expect(r.actions).toEqual([setAction("i4", 1, 2)]);
  });

  it('"a third of the queso" -> set share 1/3', () => {
    const r = parse("a third of the queso");
    expect(r.actions).toEqual([setAction("i1", 1, 3)]);
  });

  it('"2 beers" -> set share 2/1 (synonym -> Hazy IPA)', () => {
    const r = parse("2 beers");
    expect(r.actions).toEqual([setAction("i7", 2, 1)]);
    expect(r.actions[0]).toMatchObject({ share: { n: 2, d: 1 } });
  });

  it('"I had 2 margaritas" -> set share 2/1', () => {
    const r = parse("I had 2 margaritas");
    expect(r.actions).toEqual([setAction("i6", 2, 1)]);
  });

  it('"split the nachos with Alex and Maya" -> split [self, Alex, Maya]', () => {
    const r = parse("split the nachos with Alex and Maya");
    expect(r.clarification).toBeUndefined();
    expect(r.actions).toEqual([
      { type: "split", itemId: "i2", participantIds: ["p_deepak", "p_alex", "p_maya"] },
    ]);
  });

  it('"share fries with Sam" -> split [self, Sam]', () => {
    const r = parse("share fries with Sam");
    expect(r.actions).toEqual([
      { type: "split", itemId: "i4", participantIds: ["p_deepak", "p_sam"] },
    ]);
  });

  it('"I\'ll cover Sam\'s beer" -> self claims Beer 1/1', () => {
    const r = parse("I'll cover Sam's beer");
    expect(r.actions).toEqual([setAction("i7", 1, 1)]);
  });

  it('"I got Sam\'s drink" -> self claims Beer 1/1 (cover-Sam\'s-drink)', () => {
    const r = parse("I got Sam's drink");
    expect(r.actions).toEqual([setAction("i7", 1, 1)]);
  });

  it('"remove the burger" -> unclaim', () => {
    const r = parse("remove the burger");
    expect(r.actions).toEqual([{ type: "unclaim", itemId: "i3", participantId: "p_deepak" }]);
  });

  it('"I didn\'t have the fries" -> unclaim', () => {
    const r = parse("I didn't have the fries");
    expect(r.actions).toEqual([{ type: "unclaim", itemId: "i4", participantId: "p_deepak" }]);
  });

  it('"undo the tacos" -> unclaim', () => {
    const r = parse("undo the tacos");
    expect(r.actions).toEqual([{ type: "unclaim", itemId: "i5", participantId: "p_deepak" }]);
  });
});

describe("claim parser — clarification paths", () => {
  it("ambiguous item (margarita vs margarita flight) -> clarification with candidate options", () => {
    const withFlight: ReceiptItem[] = [
      ...items,
      {
        id: "i9",
        name: "Margarita Flight",
        quantity: 1,
        unitPriceCents: 1800,
        totalCents: 1800,
        sharedByAll: false,
        sortOrder: 8,
      },
    ];
    const r = parse("I had a marg", { items: withFlight });
    expect(r.actions).toEqual([]);
    expect(r.clarification).toBeDefined();
    expect(r.clarification?.options).toContain("Margarita");
    expect(r.clarification?.options).toContain("Margarita Flight");
  });

  it("no-match item -> clarification with 2-3 closest item names", () => {
    const r = parse("I had the sushi");
    expect(r.actions).toEqual([]);
    expect(r.clarification).toBeDefined();
    expect(r.clarification?.question.toLowerCase()).toContain("don't see");
    const opts = r.clarification?.options ?? [];
    expect(opts.length).toBeGreaterThanOrEqual(2);
    expect(opts.length).toBeLessThanOrEqual(3);
  });

  it("split with unknown person -> join clarification", () => {
    const r = parse("split the nachos with Jordan");
    expect(r.actions).toEqual([]);
    expect(r.clarification).toBeDefined();
    expect(r.clarification?.question).toContain("Jordan");
    expect(r.clarification?.options).toEqual(["Split among the rest", "Never mind"]);
  });

  it("empty input -> gentle example clarification", () => {
    const r = parse("");
    expect(r.actions).toEqual([]);
    expect(r.clarification).toBeDefined();
    expect(r.clarification?.question).toContain("Try:");
  });

  it("whitespace-only input -> gentle example clarification", () => {
    const r = parse("   ");
    expect(r.actions).toEqual([]);
    expect(r.clarification).toBeDefined();
  });
});

describe("claim parser — number words, plural/singular, fuzzy matching", () => {
  it('number word "two margaritas" -> 2/1', () => {
    const r = parse("two margaritas");
    expect(r.actions).toEqual([setAction("i6", 2, 1)]);
  });

  it('number word "three tacos" -> 3/1', () => {
    const r = parse("three tacos");
    expect(r.actions).toEqual([setAction("i5", 3, 1)]);
  });

  it('singular query matches plural item ("I had a taco" -> Tacos al Pastor)', () => {
    const r = parse("I had a taco");
    expect(r.actions).toEqual([setAction("i5", 1, 1)]);
  });

  it('plural query matches singular item ("I ordered margaritas" -> Margarita)', () => {
    const r = parse("I ordered margaritas");
    expect(r.actions).toEqual([setAction("i6", 1, 1)]);
  });

  it('partial word ("marg") resolves uniquely with the base receipt', () => {
    const r = parse("I had a marg");
    expect(r.actions).toEqual([setAction("i6", 1, 1)]);
  });

  it('partial word ("burger") -> Smash Burger', () => {
    const r = parse("burger");
    expect(r.actions).toEqual([setAction("i3", 1, 1)]);
  });

  it('"the smash burger was mine" -> Smash Burger 1/1', () => {
    const r = parse("the smash burger was mine");
    expect(r.actions).toEqual([setAction("i3", 1, 1)]);
  });

  it('synonym "coke"/"soda" -> Mexican Coke', () => {
    expect(parse("I had a coke").actions).toEqual([setAction("i8", 1, 1)]);
    expect(parse("I had a soda").actions).toEqual([setAction("i8", 1, 1)]);
  });
});

describe("claim parser — exact Frac values & replies", () => {
  it("set actions carry exact rational shares (assert n and d)", () => {
    const half = parse("half the fries").actions[0];
    expect(half.type).toBe("set");
    if (half.type === "set") {
      expect(half.share.n).toBe(1);
      expect(half.share.d).toBe(2);
    }

    const third = parse("a third of the queso").actions[0];
    if (third.type === "set") {
      expect(third.share.n).toBe(1);
      expect(third.share.d).toBe(3);
    }

    const two = parse("2 beers").actions[0];
    if (two.type === "set") {
      expect(two.share.n).toBe(2);
      expect(two.share.d).toBe(1);
    }

    const one = parse("I had the burger").actions[0];
    if (one.type === "set") {
      expect(one.share.n).toBe(1);
      expect(one.share.d).toBe(1);
    }
  });

  it("friendly reply names what was understood (multi-clause with a fraction)", () => {
    const r = parse("I had the burger and half the fries");
    expect(r.actions).toEqual([setAction("i3", 1, 1), setAction("i4", 1, 2)]);
    expect(r.reply).toBe("Got it — Smash Burger and ½ Truffle Fries.");
  });

  it("single-item reply", () => {
    const r = parse("I had the burger");
    expect(r.reply).toBe("Got it — Smash Burger.");
  });
});
