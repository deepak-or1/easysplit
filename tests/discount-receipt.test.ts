import { describe, expect, it } from "vitest";
import { normalizeParsed } from "@/lib/ocr";
import {
  buildCreatePayload,
  discountPreviewCents,
  emptyDraft,
  type Draft,
  type DraftItem,
} from "@/components/new/helpers";
import type { ParsedReceipt, ParsedReceiptItem } from "@/lib/types";

/**
 * Whole-bill discounts, from the receipt into the create wizard.
 *
 * Two things can feed the receipt-level discount: what the model read off the
 * bill ("15% OFF ENTIRE CHECK"), and per-line discount money the fold couldn't
 * match to any item. The second only lands when the PRINTED subtotal proves it
 * is still outstanding (Σ items − unmatched === printed subtotal); a warehouse
 * subtotal already net of that money would otherwise get it subtracted twice,
 * silently undercharging the table. Unconfirmed, the money stays out and the
 * host is warned instead.
 */

const item = (p: Partial<ParsedReceiptItem>): ParsedReceiptItem => ({
  name: "THING",
  quantity: 1,
  unitPriceCents: 100,
  totalCents: 100,
  ...p,
});

function raw(p: Partial<ParsedReceipt>): ParsedReceipt {
  return {
    restaurantName: "Taqueria",
    date: null,
    items: [item({ name: "Tacos", unitPriceCents: 1000, totalCents: 1000 })],
    subtotalCents: 1000,
    taxCents: 0,
    tipCents: 0,
    totalCents: 1000,
    ...p,
  };
}

describe("normalizeParsed — receipt-level discount", () => {
  it("is 0 when the model reports none", () => {
    expect(normalizeParsed(raw({})).receipt.discountCents).toBe(0);
  });

  it("is 0 when the field is missing entirely", () => {
    const { discountCents } = normalizeParsed(raw({ discountCents: undefined })).receipt;
    expect(discountCents).toBe(0);
  });

  it("keeps a whole-bill discount the model read", () => {
    expect(normalizeParsed(raw({ discountCents: 150 })).receipt.discountCents).toBe(150);
  });

  it("rounds a fractional read and floors a negative one at 0", () => {
    expect(normalizeParsed(raw({ discountCents: 150.6 })).receipt.discountCents).toBe(151);
    expect(normalizeParsed(raw({ discountCents: -500 })).receipt.discountCents).toBe(0);
  });

  it("clamps an absurd read at the $100,000 ceiling", () => {
    // Same bound tax and tip get: this parse also runs on inbound MMS, where
    // the "receipt" is whatever a stranger texted in.
    expect(normalizeParsed(raw({ discountCents: 1e12 })).receipt.discountCents).toBe(10_000_000);
  });

  it("leaves the whole-bill discount out of the items", () => {
    const { receipt } = normalizeParsed(raw({ discountCents: 150 }));
    expect(receipt.items).toEqual([
      { name: "Tacos", quantity: 1, unitPriceCents: 1000, totalCents: 1000 },
    ]);
    expect(receipt.subtotalCents).toBe(1000);
  });
});

describe("normalizeParsed — unmatched line discounts fold only when the subtotal confirms it", () => {
  it("does NOT fold when the printed subtotal already includes the money", () => {
    // Σ items (1579) IS the printed subtotal, so the $3.20 was already taken
    // off before it was printed. Folding it would charge the table $3.20 less
    // than the receipt says. Warn instead.
    const { receipt, warning } = normalizeParsed(
      raw({
        items: [
          item({ name: "/1218574", unitPriceCents: -320, totalCents: -320 }),
          item({ name: "SWIFR WET 64", unitPriceCents: 1579, totalCents: 1579 }),
        ],
        subtotalCents: 1579,
      }),
    );

    expect(receipt.items).toEqual([
      { name: "SWIFR WET 64", quantity: 1, unitPriceCents: 1579, totalCents: 1579 },
    ]);
    expect(receipt.discountCents).toBe(0);
    expect(receipt.subtotalCents).toBe(1579);
    expect(warning).toBe(
      "$3.20 in discounts couldn't be matched to an item — the prices below may read a little high.",
    );
  });

  it("folds when the printed subtotal proves the money is still outstanding", () => {
    // Σ items (1579) − unmatched (320) lands exactly on the printed 1259: the
    // discount hasn't been taken off the items, so it comes off the bill.
    const { receipt, warning } = normalizeParsed(
      raw({
        items: [
          item({ name: "/1218574", unitPriceCents: -320, totalCents: -320 }),
          item({ name: "SWIFR WET 64", unitPriceCents: 1579, totalCents: 1579 }),
        ],
        subtotalCents: 1259,
      }),
    );

    expect(receipt.items).toEqual([
      { name: "SWIFR WET 64", quantity: 1, unitPriceCents: 1579, totalCents: 1579 },
    ]);
    expect(receipt.discountCents).toBe(320);
    // The PRE-discount base, so the check step's Σ-items comparison stays quiet.
    expect(receipt.subtotalCents).toBe(1579);
    expect(warning).toBeNull();
  });

  it("does not fold the remainder of an oversized line discount", () => {
    const { receipt, warning } = normalizeParsed(
      raw({
        items: [
          item({ name: "VRTYMIXFRUIT", unitPriceCents: 200, totalCents: 200 }),
          item({ name: "INSTANT SAVINGS", unitPriceCents: -500, totalCents: -500 }),
        ],
        // No printed subtotal at all — nothing to confirm the fold against.
        subtotalCents: 0,
      }),
    );

    // $2.00 landed on the item; the other $3.00 has nothing vouching for it.
    expect(receipt.items).toEqual([
      { name: "VRTYMIXFRUIT", quantity: 1, unitPriceCents: 0, totalCents: 0 },
    ]);
    expect(receipt.discountCents).toBe(0);
    expect(warning).toBe(
      "$3.00 in discounts couldn't be matched to an item — the prices below may read a little high.",
    );
  });

  it("leaves the model's own whole-bill discount alone when the fold isn't confirmed", () => {
    const { receipt, warning } = normalizeParsed(
      raw({
        items: [
          item({ name: "/1218574", unitPriceCents: -320, totalCents: -320 }),
          item({ name: "SWIFR WET 64", unitPriceCents: 1579, totalCents: 1579 }),
        ],
        subtotalCents: 1579,
        discountCents: 150,
      }),
    );
    expect(receipt.discountCents).toBe(150);
    expect(warning).toContain("$3.20");
  });

  it("still nets a matched line discount into its item, leaving the bill alone", () => {
    const { receipt, warning } = normalizeParsed(
      raw({
        items: [
          item({ name: "SWIFR WET 64", unitPriceCents: 1579, totalCents: 1579 }),
          item({ name: "/1218574", unitPriceCents: -320, totalCents: -320 }),
        ],
        subtotalCents: 1259,
      }),
    );
    expect(receipt.items).toEqual([
      { name: "SWIFR WET 64", quantity: 1, unitPriceCents: 1259, totalCents: 1259 },
    ]);
    expect(receipt.discountCents).toBe(0);
    expect(warning).toBeNull();
  });

  it("clamps the combined total at the ceiling", () => {
    const { receipt } = normalizeParsed(
      raw({
        items: [
          item({ name: "/1", unitPriceCents: -1000, totalCents: -1000 }),
          item({ name: "THING", unitPriceCents: 5000, totalCents: 5000 }),
        ],
        // 5000 − 1000: a confirmed fold, so both sources really do combine.
        subtotalCents: 4000,
        discountCents: 10_000_000,
      }),
    );
    expect(receipt.discountCents).toBe(10_000_000);
  });
});

/* ------------------------------ create wizard ----------------------------- */

function draftWith(p: Partial<Draft>): Draft {
  const items: DraftItem[] = [
    { key: "k1", name: "Tacos", quantity: 1, price: "60.00", sharedByAll: false },
    { key: "k2", name: "Horchata", quantity: 1, price: "40.00", sharedByAll: false },
  ];
  return { ...emptyDraft(), hostName: "Ada", items, ...p };
}

describe("discountPreviewCents", () => {
  it("is 0 on an untouched draft — no discount until one is entered", () => {
    expect(discountPreviewCents(draftWith({}))).toBe(0);
  });

  it("takes a percent of the items subtotal", () => {
    expect(discountPreviewCents(draftWith({ discountMode: "percent", discountPercent: 15 }))).toBe(
      1500,
    );
  });

  it("reads a flat amount out of the dollar field", () => {
    expect(discountPreviewCents(draftWith({ discountMode: "amount", discountFlat: "4.50" }))).toBe(
      450,
    );
  });

  it("clamps a flat amount to the items subtotal", () => {
    expect(
      discountPreviewCents(draftWith({ discountMode: "amount", discountFlat: "500.00" })),
    ).toBe(10_000);
  });

  it("clamps to 0 when there are no items to discount", () => {
    expect(
      discountPreviewCents(
        draftWith({ items: [], discountMode: "amount", discountFlat: "500.00" }),
      ),
    ).toBe(0);
    expect(
      discountPreviewCents(draftWith({ items: [], discountMode: "percent", discountPercent: 15 })),
    ).toBe(0);
  });

  it("floors a nonsense entry at 0", () => {
    expect(discountPreviewCents(draftWith({ discountMode: "amount", discountFlat: "abc" }))).toBe(0);
    expect(discountPreviewCents(draftWith({ discountMode: "percent", discountPercent: -5 }))).toBe(
      0,
    );
  });

  it("survives a grocery run — coupons are exactly what a cart has", () => {
    expect(
      discountPreviewCents(
        draftWith({ splitType: "grocery", discountMode: "percent", discountPercent: 10 }),
      ),
    ).toBe(1000);
  });
});

describe("buildCreatePayload — discount fields", () => {
  it("sends no discount when none was entered", () => {
    const payload = buildCreatePayload(draftWith({}));
    expect(payload.discountType).toBeNull();
    expect(payload.discountValue).toBe(0);
  });

  it("sends the percent the host chose", () => {
    const payload = buildCreatePayload(draftWith({ discountMode: "percent", discountPercent: 15 }));
    expect(payload.discountType).toBe("percent");
    expect(payload.discountValue).toBe(15);
  });

  it("sends a flat amount as whole cents", () => {
    const payload = buildCreatePayload(draftWith({ discountMode: "amount", discountFlat: "4.50" }));
    expect(payload.discountType).toBe("amount");
    expect(payload.discountValue).toBe(450);
  });

  it("sends the raw amount even when it exceeds the subtotal — the server clamps", () => {
    const payload = buildCreatePayload(
      draftWith({ discountMode: "amount", discountFlat: "500.00" }),
    );
    expect(payload.discountValue).toBe(50_000);
  });

  it("sends no discount when the mode is set but the field is empty", () => {
    const payload = buildCreatePayload(draftWith({ discountMode: "amount", discountFlat: "" }));
    expect(payload.discountType).toBeNull();
    expect(payload.discountValue).toBe(0);
  });

  it("keeps the discount on a grocery run, where the tip is zeroed", () => {
    const payload = buildCreatePayload(
      draftWith({ splitType: "grocery", discountMode: "percent", discountPercent: 10 }),
    );
    expect(payload.tipValue).toBe(0);
    expect(payload.discountType).toBe("percent");
    expect(payload.discountValue).toBe(10);
  });
});
