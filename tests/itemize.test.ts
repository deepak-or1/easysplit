import { describe, expect, it } from "vitest";
import { isItemizable, itemizeCents, itemizedName, itemizeLine } from "@/lib/itemize";
import { buildCreatePayload, emptyDraft, itemizableItems, type Draft, type DraftItem } from "@/components/new/helpers";
import { computeSettlement, type SettlementInput } from "@/lib/split-math";
import { fr } from "@/lib/fraction";
import type { Claim, Participant, ReceiptItem } from "@/lib/types";

/**
 * Rajvir's table: four vodka pastas on one ×4 line. Taran and Rishabh shared
 * one, Anushka and Dev each had their own, and Arushi, Aryan, Keerthana and
 * Devanshi shared the last. One line can't express that — the quantity
 * fractions the room offers are halves and thirds of the whole ×4 line — so
 * the host itemizes it into four ×1 lines and everyone splits their own plate.
 */

describe("itemizeCents", () => {
  it("splits evenly when the total divides", () => {
    expect(itemizeCents(8000, 4)).toEqual([2000, 2000, 2000, 2000]);
  });

  it("never loses a cent on an indivisible total — the remainder goes to the first rows", () => {
    const rows = itemizeCents(1000, 3);
    expect(rows).toEqual([334, 333, 333]);
    expect(rows.reduce((s, c) => s + c, 0)).toBe(1000);
  });

  it("returns the total untouched for quantity 1 (or nonsense)", () => {
    expect(itemizeCents(1999, 1)).toEqual([1999]);
    expect(itemizeCents(1999, 0)).toEqual([1999]);
    expect(itemizeCents(1999, Number.NaN)).toEqual([1999]);
  });
});

describe("itemizedName", () => {
  it("numbers each row so the guest list still reads as one order", () => {
    expect(itemizedName("Vodka Pasta", 0, 4)).toBe("Vodka Pasta (1 of 4)");
    expect(itemizedName("Vodka Pasta", 3, 4)).toBe("Vodka Pasta (4 of 4)");
  });

  it("trims a long name so the suffix survives the API's 80-char limit", () => {
    const long = "Pappardelle with slow-braised short rib ragù, pecorino and a truly excessive garnish";
    const name = itemizedName(long, 9, 12);
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith("… (10 of 12)")).toBe(true);
  });
});

describe("itemizeLine", () => {
  it("expands a ×N line into N single-unit rows that sum to the line total", () => {
    const rows = itemizeLine({ name: "Vodka Pasta", quantity: 4, totalCents: 8000 });
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.quantity).toBe(1);
      expect(row.unitPriceCents).toBe(row.totalCents);
      expect(row.totalCents).toBe(2000);
    }
    expect(rows.map((r) => r.name)).toEqual([
      "Vodka Pasta (1 of 4)",
      "Vodka Pasta (2 of 4)",
      "Vodka Pasta (3 of 4)",
      "Vodka Pasta (4 of 4)",
    ]);
  });

  it("passes a ×1 line through unchanged, name included", () => {
    expect(itemizeLine({ name: "Tiramisu", quantity: 1, totalCents: 1200 })).toEqual([
      { name: "Tiramisu", quantity: 1, unitPriceCents: 1200, totalCents: 1200 },
    ]);
  });

  it("reports what's itemizable", () => {
    expect(isItemizable({ quantity: 1 })).toBe(false);
    expect(isItemizable({ quantity: 2 })).toBe(true);
  });
});

/* -------------------------- create-wizard payload -------------------------- */

function draftWith(items: DraftItem[], extra: Partial<Draft> = {}): Draft {
  return { ...emptyDraft(), hostName: "Raj", items, ...extra };
}

const PASTA: DraftItem = { key: "p", name: "Vodka Pasta", quantity: 4, price: "20.00", sharedByAll: false };
const WATER: DraftItem = { key: "w", name: "Sparkling water", quantity: 1, price: "6.00", sharedByAll: true };
const BLANK: DraftItem = { key: "b", name: "", quantity: 3, price: "1.00", sharedByAll: false };

describe("buildCreatePayload — itemizeQuantities", () => {
  it("is off by default: the ×4 line ships as one line", () => {
    const { items } = buildCreatePayload(draftWith([PASTA, WATER]));
    expect(items.map((i) => [i.name, i.quantity, i.totalCents])).toEqual([
      ["Vodka Pasta", 4, 8000],
      ["Sparkling water", 1, 600],
    ]);
  });

  it("on: each unit becomes its own ×1 line, in place, with the same subtotal", () => {
    const off = buildCreatePayload(draftWith([PASTA, WATER]));
    const on = buildCreatePayload(draftWith([PASTA, WATER], { itemizeQuantities: true }));
    expect(on.items.map((i) => [i.name, i.quantity, i.totalCents, i.sharedByAll])).toEqual([
      ["Vodka Pasta (1 of 4)", 1, 2000, false],
      ["Vodka Pasta (2 of 4)", 1, 2000, false],
      ["Vodka Pasta (3 of 4)", 1, 2000, false],
      ["Vodka Pasta (4 of 4)", 1, 2000, false],
      ["Sparkling water", 1, 600, true],
    ]);
    const sum = (p: typeof on) => p.items.reduce((s, i) => s + i.totalCents, 0);
    expect(sum(on)).toBe(sum(off));
  });

  it("itemizes from the receipt's printed total when the unit price was back-filled", () => {
    // "3 Tacos $10.00" → ocr back-fills 333¢/unit; the printed 1000¢ must win.
    const tacos: DraftItem = {
      key: "t",
      name: "Tacos",
      quantity: 3,
      price: "3.33",
      sharedByAll: false,
      receiptTotalCents: 1000,
    };
    const { items } = buildCreatePayload(draftWith([tacos], { itemizeQuantities: true }));
    expect(items.map((i) => i.totalCents)).toEqual([334, 333, 333]);
  });

  it("only counts named ×N lines as itemizable", () => {
    expect(itemizableItems([PASTA, WATER, BLANK]).map((i) => i.key)).toEqual(["p"]);
  });
});

/* -------------------------- end to end: the table -------------------------- */

function person(id: string, name: string): Participant {
  return { id, name, isHost: false, isBirthday: false, paidStatus: "unpaid", joinedAt: "2026-09-26T00:00:00.000Z" };
}

describe("itemized pastas settle the way the table ate them", () => {
  const rows = itemizeLine({ name: "Vodka Pasta", quantity: 4, totalCents: 8000 });
  const items: ReceiptItem[] = rows.map((r, i) => ({ id: `p${i + 1}`, ...r, sharedByAll: false, sortOrder: i }));
  const names = ["Taran", "Rishabh", "Anushka", "Dev", "Arushi", "Aryan", "Keerthana", "Devanshi"];
  const participants = names.map((n) => person(n.toLowerCase(), n));
  const claims: Claim[] = [
    { itemId: "p1", participantId: "taran", share: fr(1, 2) },
    { itemId: "p1", participantId: "rishabh", share: fr(1, 2) },
    { itemId: "p2", participantId: "anushka", share: fr(1) },
    { itemId: "p3", participantId: "dev", share: fr(1) },
    ...["arushi", "aryan", "keerthana", "devanshi"].map((id) => ({ itemId: "p4", participantId: id, share: fr(1, 4) })),
  ];
  const input: SettlementInput = {
    items,
    participants,
    claims,
    taxCents: 0,
    tipType: "percent",
    tipValue: 0,
  };

  it("charges $10 to each sharer of a pair, $20 to a solo plate, $5 to each of the four", () => {
    const s = computeSettlement(input);
    const owed = Object.fromEntries(s.people.map((p) => [p.participantId, p.itemsCents]));
    expect(owed).toEqual({
      taran: 1000,
      rishabh: 1000,
      anushka: 2000,
      dev: 2000,
      arushi: 500,
      aryan: 500,
      keerthana: 500,
      devanshi: 500,
    });
    expect(s.unclaimed.itemsCents).toBe(0);
    expect(s.reconciles).toBe(true);
  });
});
