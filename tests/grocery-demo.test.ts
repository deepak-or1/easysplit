import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEMO_GROCERY_RECEIPT, DEMO_RECEIPT } from "@/lib/demo-receipt";
import type { ReceiptParseResponse } from "@/lib/types";

/**
 * The grocery demo receipt, and the parse route's demo branch that serves it.
 *
 * The receipt's arithmetic is load-bearing, not cosmetic: the wizard compares
 * the printed subtotal against the sum of the items it was handed and warns the
 * host when they disagree, so a demo whose numbers don't add up would ship a
 * permanent "worth a second look" banner. The odd Avocados line is deliberate —
 * it's the only line whose printed total can't be reproduced from quantity ×
 * unit price, which is exactly what makes itemsFromReceipt keep
 * receiptTotalCents instead of silently re-multiplying.
 */

// The route pulls in the store (rate limiting on the OCR path), which resolves
// its DB path at import time — point it at a throwaway file. The demo branch
// never reaches a query, so nothing should actually be created.
const dbFile = path.join(os.tmpdir(), `settle-grocery-demo-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_FILE = dbFile;
delete process.env.DATABASE_URL;

const { POST } = await import("@/app/api/receipts/parse/route");

afterAll(() => {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* never created */
    }
  }
});

async function parse(body: unknown): Promise<{ status: number; body: ReceiptParseResponse }> {
  const res = await POST(
    new Request("http://localhost/api/receipts/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as ReceiptParseResponse };
}

describe("DEMO_GROCERY_RECEIPT — internal consistency", () => {
  const r = DEMO_GROCERY_RECEIPT;

  it("is a full cart: at least 14 lines, at least two of them multi-unit", () => {
    expect(r.items.length).toBeGreaterThanOrEqual(14);
    expect(r.items.filter((it) => it.quantity > 1).length).toBeGreaterThanOrEqual(2);
  });

  it("prints a subtotal that equals the sum of its item totals", () => {
    const sum = r.items.reduce((acc, it) => acc + it.totalCents, 0);
    expect(r.subtotalCents).toBe(sum);
  });

  it("totals to subtotal + tax, with no tip on a grocery run", () => {
    expect(r.tipCents).toBe(0);
    expect(r.totalCents).toBe(r.subtotalCents + r.taxCents);
  });

  it("charges a plausible grocery tax (8–9% of the subtotal)", () => {
    const rate = r.taxCents / r.subtotalCents;
    expect(rate).toBeGreaterThan(0.08);
    expect(rate).toBeLessThan(0.09);
  });

  it("has exactly one indivisible line — a printed total quantity × unit can't reach", () => {
    const odd = r.items.filter((it) => it.totalCents !== it.quantity * it.unitPriceCents);
    expect(odd).toHaveLength(1);
    // …and its unit price is the rounded quotient, the way OCR back-fills one.
    expect(odd[0].unitPriceCents).toBe(Math.round(odd[0].totalCents / odd[0].quantity));
    expect(odd[0].quantity).toBeGreaterThan(1);
  });

  it("names the store and leaves the date to creation time", () => {
    expect(r.restaurantName).toBe("Green Basket Market");
    expect(r.date).toBeNull();
  });

  it("leaves the restaurant demo alone", () => {
    expect(DEMO_RECEIPT.restaurantName).toBe("El Camino Cantina");
    expect(DEMO_RECEIPT.subtotalCents).toBe(11700);
  });
});

describe("POST /api/receipts/parse — the demo branch picks a receipt by kind", () => {
  it("returns the grocery cart when the grocery flag is set", async () => {
    const res = await parse({ demo: true, kind: "grocery" });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("mock");
    expect(res.body.receipt.restaurantName).toBe("Green Basket Market");
    expect(res.body.receipt).toEqual(DEMO_GROCERY_RECEIPT);
  });

  it("returns the restaurant check when no kind is sent", async () => {
    const res = await parse({ demo: true });
    expect(res.status).toBe(200);
    expect(res.body.receipt.restaurantName).toBe("El Camino Cantina");
  });

  it("returns the restaurant check for an explicit restaurant kind", async () => {
    const res = await parse({ demo: true, kind: "restaurant" });
    expect(res.status).toBe(200);
    expect(res.body.receipt.restaurantName).toBe("El Camino Cantina");
  });

  it("falls back to the restaurant check for an unknown kind, rather than 400ing", async () => {
    for (const kind of ["bodega", "", "GROCERY", 7, null]) {
      const res = await parse({ demo: true, kind });
      expect(res.status).toBe(200);
      expect(res.body.receipt.restaurantName).toBe("El Camino Cantina");
    }
  });
});
