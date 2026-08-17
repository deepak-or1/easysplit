import { describe, expect, it } from "vitest";
import { isDiscountName, normalizeItems, normalizeParsed } from "@/lib/ocr";
import type { ParsedReceipt, ParsedReceiptItem } from "@/lib/types";

/**
 * Costco (and every warehouse club) prints discounts as their own line: a bare
 * item number naming the item they apply to, with a trailing-minus amount
 * (`3.20-`). When the model emits those as items, the old non-negative clamp
 * turned them into unclaimable "$0.00 /1218574" rows AND left the discounted
 * item at its gross price. normalizeItems folds them instead.
 */

const item = (p: Partial<ParsedReceiptItem>): ParsedReceiptItem => ({
  name: "THING",
  quantity: 1,
  unitPriceCents: 100,
  totalCents: 100,
  ...p,
});

describe("normalizeItems — discount folding", () => {
  it("folds a negative line into the item above it", () => {
    const { items, warning } = normalizeItems([
      item({ name: "SWIFR WET 64", unitPriceCents: 1579, totalCents: 1579 }),
      item({ name: "/1218574", unitPriceCents: -320, totalCents: -320 }),
    ]);

    expect(items).toEqual([
      { name: "SWIFR WET 64", quantity: 1, unitPriceCents: 1259, totalCents: 1259 },
    ]);
    expect(warning).toBeNull();
  });

  it("recomputes unit price from the net total on a multi-quantity item", () => {
    const { items, warning } = normalizeItems([
      item({ name: "WOODBRG MERL", quantity: 6, unitPriceCents: 899, totalCents: 5394 }),
      item({ name: "/9273", unitPriceCents: -600, totalCents: -600 }),
    ]);

    // 5394 − 600 = 4794 across 6 bottles → 799 each.
    expect(items).toEqual([
      { name: "WOODBRG MERL", quantity: 6, unitPriceCents: 799, totalCents: 4794 },
    ]);
    expect(warning).toBeNull();
  });

  it("applies each discount to its own immediately preceding item", () => {
    const { items } = normalizeItems([
      item({ name: "CREST SCOPE", unitPriceCents: 1299, totalCents: 1299 }),
      item({ name: "/1746385", unitPriceCents: -400, totalCents: -400 }),
      item({ name: "ORAL-B CROSS", unitPriceCents: 1499, totalCents: 1499 }),
      item({ name: "/1746391", unitPriceCents: -500, totalCents: -500 }),
    ]);

    expect(items.map((i) => [i.name, i.totalCents])).toEqual([
      ["CREST SCOPE", 899],
      ["ORAL-B CROSS", 999],
    ]);
  });

  it("floors an oversized discount at zero and reports the remainder", () => {
    const { items, unappliedDiscountCents, warning } = normalizeItems([
      item({ name: "VRTYMIXFRUIT", unitPriceCents: 200, totalCents: 200 }),
      item({ name: "INSTANT SAVINGS", unitPriceCents: -500, totalCents: -500 }),
    ]);

    expect(items).toEqual([
      { name: "VRTYMIXFRUIT", quantity: 1, unitPriceCents: 0, totalCents: 0 },
    ]);
    // $2.00 of the $5.00 landed on the item; the other $3.00 is reported here
    // and normalizeParsed decides (against the printed subtotal) whether it
    // becomes a receipt-level discount or a warning.
    expect(unappliedDiscountCents).toBe(300);
    expect(warning).toBeNull();
  });

  it("drops a leading negative line — there is no item above it to discount", () => {
    const { items, unappliedDiscountCents, warning } = normalizeItems([
      item({ name: "/1218574", unitPriceCents: -320, totalCents: -320 }),
      item({ name: "SWIFR WET 64", unitPriceCents: 1579, totalCents: 1579 }),
    ]);

    expect(items).toEqual([
      { name: "SWIFR WET 64", quantity: 1, unitPriceCents: 1579, totalCents: 1579 },
    ]);
    expect(unappliedDiscountCents).toBe(320);
    expect(warning).toBeNull();
  });

  it("treats a per-unit-only negative price as a discount", () => {
    const { items } = normalizeItems([
      item({ name: "KS PAPER TWL", unitPriceCents: 2299, totalCents: 2299 }),
      item({ name: "MFR COUPON", unitPriceCents: -300, totalCents: 0 }),
    ]);

    expect(items).toEqual([
      { name: "KS PAPER TWL", quantity: 1, unitPriceCents: 1999, totalCents: 1999 },
    ]);
  });

  it("drops zero-total discount-shaped rows without anchoring later folds", () => {
    const { items, warning } = normalizeItems([
      item({ name: "SWIFR WET 64", unitPriceCents: 1579, totalCents: 1579 }),
      // Already clamped to $0 by the model itself.
      item({ name: "/1218574", unitPriceCents: 0, totalCents: 0 }),
      // …and this one still arrives negative: it must land on SWIFR, not on the
      // dropped row.
      item({ name: "1218574 (discount)", unitPriceCents: -320, totalCents: -320 }),
    ]);

    expect(items).toEqual([
      { name: "SWIFR WET 64", quantity: 1, unitPriceCents: 1259, totalCents: 1259 },
    ]);
    expect(warning).toBeNull();
  });

  it("keeps ordinary zero-priced items with normal names", () => {
    const { items, warning } = normalizeItems([
      item({ name: "Coke (included)", unitPriceCents: 0, totalCents: 0 }),
      item({ name: "Table water", unitPriceCents: 0, totalCents: 0 }),
      item({ name: "Ribeye", unitPriceCents: 3200, totalCents: 3200 }),
    ]);

    expect(items).toEqual([
      { name: "Coke (included)", quantity: 1, unitPriceCents: 0, totalCents: 0 },
      { name: "Table water", quantity: 1, unitPriceCents: 0, totalCents: 0 },
      { name: "Ribeye", quantity: 1, unitPriceCents: 3200, totalCents: 3200 },
    ]);
    expect(warning).toBeNull();
  });
});

describe("isDiscountName", () => {
  it("matches bare item numbers and savings words only", () => {
    for (const n of ["/1218574", "1218574", " /9273 ", "INSTANT SAVINGS", "Coupon", "discount"]) {
      expect(isDiscountName(n), n).toBe(true);
    }
    for (const n of ["Ribeye", "Coke (included)", "SWIFR WET 64", "7UP 12PK", "Table water"]) {
      expect(isDiscountName(n), n).toBe(false);
    }
  });
});

describe("normalizeParsed", () => {
  it("leaves a receipt with no discounts exactly as it was", () => {
    const raw: ParsedReceipt = {
      restaurantName: "  Trattoria  ",
      date: "2026-07-27",
      items: [
        item({ name: "Margherita", quantity: 2, unitPriceCents: 1400, totalCents: 2800 }),
        // unit price missing → derived from the total, as before
        item({ name: "Negroni", quantity: 1, unitPriceCents: 0, totalCents: 1600 }),
        // total missing → derived from the unit price, as before
        item({ name: "Tiramisu", quantity: 2, unitPriceCents: 900, totalCents: 0 }),
      ],
      subtotalCents: 6200,
      taxCents: 512,
      tipCents: 1200,
      totalCents: 0,
    };

    expect(normalizeParsed(raw)).toEqual({
      receipt: {
        restaurantName: "Trattoria",
        date: "2026-07-27",
        items: [
          { name: "Margherita", quantity: 2, unitPriceCents: 1400, totalCents: 2800 },
          { name: "Negroni", quantity: 1, unitPriceCents: 1600, totalCents: 1600 },
          { name: "Tiramisu", quantity: 2, unitPriceCents: 900, totalCents: 1800 },
        ],
        subtotalCents: 6200,
        taxCents: 512,
        tipCents: 1200,
        discountCents: 0,
        totalCents: 6200 + 512 + 1200,
      },
      warning: null,
    });
  });

  it("nets the discount out of the items and keeps the printed subtotal", () => {
    const { receipt, warning } = normalizeParsed({
      restaurantName: "Costco",
      date: null,
      items: [
        item({ name: "SWIFR WET 64", unitPriceCents: 1579, totalCents: 1579 }),
        item({ name: "/1218574", unitPriceCents: -320, totalCents: -320 }),
        item({ name: "CREST SCOPE", unitPriceCents: 1299, totalCents: 1299 }),
        item({ name: "/1746385", unitPriceCents: -400, totalCents: -400 }),
      ],
      // Warehouse subtotals are already net of discounts.
      subtotalCents: 2158,
      taxCents: 100,
      tipCents: 0,
      totalCents: 0,
    });

    expect(receipt.items.map((i) => i.totalCents)).toEqual([1259, 899]);
    expect(receipt.items.reduce((s, i) => s + i.totalCents, 0)).toBe(receipt.subtotalCents);
    expect(receipt.subtotalCents).toBe(2158);
    expect(receipt.totalCents).toBe(2258);
    expect(warning).toBeNull();
  });
});
