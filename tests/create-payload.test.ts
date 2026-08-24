import { describe, expect, it } from "vitest";
import {
  applyItemEdit,
  buildCreatePayload,
  emptyDraft,
  itemLineCents,
  itemsFromReceipt,
  type Draft,
  type DraftItem,
} from "@/components/new/helpers";
import type { ParsedReceipt, ParsedReceiptItem } from "@/lib/types";

/**
 * The create wizard used to throw away the receipt's printed line total: ocr.ts
 * back-fills unitPriceCents = round(totalCents / quantity), so "3 Tacos $10.00"
 * became 3 × 333 = 999 — a cent short of what the restaurant charged.
 */

function receipt(items: ParsedReceiptItem[]): ParsedReceipt {
  const subtotalCents = items.reduce((s, it) => s + it.totalCents, 0);
  return {
    restaurantName: "Taqueria",
    date: "2026-07-27",
    items,
    subtotalCents,
    taxCents: 0,
    tipCents: 0,
    totalCents: subtotalCents,
  };
}

/** A draft carrying exactly these items, as the wizard would hold it. */
function draftWith(items: DraftItem[]): Draft {
  return { ...emptyDraft(), hostName: "Ada", items };
}

const INDIVISIBLE: ParsedReceiptItem = {
  name: "Tacos",
  quantity: 3,
  unitPriceCents: 333,
  totalCents: 1000,
};
const CLEAN: ParsedReceiptItem = {
  name: "Horchata",
  quantity: 2,
  unitPriceCents: 500,
  totalCents: 1000,
};

describe("itemsFromReceipt — keeping the printed line total", () => {
  it("keeps totalCents when quantity × unit price can't reproduce it", () => {
    const [item] = itemsFromReceipt(receipt([INDIVISIBLE]));
    expect(item.receiptTotalCents).toBe(1000);
    expect(item.quantity).toBe(3);
    expect(item.price).toBe("3.33");
  });

  it("leaves it undefined when the arithmetic already agrees", () => {
    const [item] = itemsFromReceipt(receipt([CLEAN]));
    expect(item.receiptTotalCents).toBeUndefined();
  });

  it("previews the line at the printed total, matching what gets created", () => {
    const [indivisible, clean] = itemsFromReceipt(receipt([INDIVISIBLE, CLEAN]));
    expect(itemLineCents(indivisible)).toBe(1000);
    expect(itemLineCents(clean)).toBe(1000);
  });
});

describe("buildCreatePayload — line totals sent to the API", () => {
  it("sends the printed total, not quantity × unit price", () => {
    const payload = buildCreatePayload(draftWith(itemsFromReceipt(receipt([INDIVISIBLE]))));
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      name: "Tacos",
      quantity: 3,
      unitPriceCents: 333,
      totalCents: 1000,
    });
  });

  it("still sends quantity × unit price for ordinary items", () => {
    const payload = buildCreatePayload(draftWith(itemsFromReceipt(receipt([CLEAN]))));
    expect(payload.items[0].totalCents).toBe(1000);
    expect(payload.items[0].unitPriceCents).toBe(500);
  });

  it("reverts to quantity × unit price after the host edits the price", () => {
    const [item] = itemsFromReceipt(receipt([INDIVISIBLE]));
    const edited = applyItemEdit(item, { price: "3.50" });
    expect(edited.receiptTotalCents).toBeUndefined();
    expect(itemLineCents(edited)).toBe(1050);
    expect(buildCreatePayload(draftWith([edited])).items[0].totalCents).toBe(1050);
  });

  it("reverts to quantity × unit price after the host edits the quantity", () => {
    const [item] = itemsFromReceipt(receipt([INDIVISIBLE]));
    const edited = applyItemEdit(item, { quantity: 2 });
    expect(edited.receiptTotalCents).toBeUndefined();
    expect(itemLineCents(edited)).toBe(666);
    expect(buildCreatePayload(draftWith([edited])).items[0].totalCents).toBe(666);
  });

  it("keeps the printed total across edits that aren't price or quantity", () => {
    const [item] = itemsFromReceipt(receipt([INDIVISIBLE]));
    const renamed = applyItemEdit(applyItemEdit(item, { name: "Al pastor" }), {
      sharedByAll: true,
    });
    expect(renamed.receiptTotalCents).toBe(1000);
    expect(buildCreatePayload(draftWith([renamed])).items[0].totalCents).toBe(1000);
  });

  it("hand-added items never carry a printed total", () => {
    const payload = buildCreatePayload(
      draftWith([{ key: "k", name: "Churros", quantity: 3, price: "3.33", sharedByAll: false }]),
    );
    expect(payload.items[0].totalCents).toBe(999);
  });
});

describe("buildCreatePayload — declared group size", () => {
  const items = itemsFromReceipt(receipt([CLEAN]));

  it("sends null when the field was left blank", () => {
    expect(buildCreatePayload(draftWith(items)).groupSize).toBeNull();
  });

  it("sends the typed headcount as a number", () => {
    const payload = buildCreatePayload({ ...draftWith(items), groupSize: "5" });
    expect(payload.groupSize).toBe(5);
  });

  it("treats unparseable input as not declared", () => {
    const payload = buildCreatePayload({ ...draftWith(items), groupSize: "abc" });
    expect(payload.groupSize).toBeNull();
  });
});
