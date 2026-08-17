import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * POST /api/splits — discount bounds.
 *
 * The same treatment the tip gets (an unbounded percent multiplied by the
 * subtotal is what poisons a room), with one difference: more than 100% off a
 * bill is meaningless, so the percent cap is 100 rather than the tip's 500. An
 * AMOUNT larger than the current subtotal is deliberately accepted — the items
 * can still change — and clamped at compute time instead. The schema is
 * module-private (Next rejects non-handler exports from route files), so these
 * drive the real handler.
 */

const dbFile = path.join(os.tmpdir(), `settle-discount-bounds-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_FILE = dbFile;
delete process.env.DATABASE_URL;

const { POST } = await import("@/app/api/splits/route");
const { getRoomState } = await import("@/lib/store");

afterAll(() => {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* never created */
    }
  }
});

/** Body as a raw string so JSON values JS can't literal-ize (Infinity) survive. */
function bodyWith(discountJson: string): string {
  return `{
    "hostName": "Ada",
    "tipType": "percent",
    "tipValue": 20,
    ${discountJson}
    "taxCents": 0,
    "items": [{ "name": "Tacos", "quantity": 1, "unitPriceCents": 1000, "totalCents": 1000 }]
  }`;
}

async function post(raw: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await POST(
    new Request("http://localhost/api/splits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("POST /api/splits — discountValue bounds", () => {
  it("rejects a negative discount", async () => {
    const res = await post(bodyWith(`"discountType": "percent", "discountValue": -1,`));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("discount can't be negative");
    expect(res.body.splitId).toBeUndefined();
  });

  it("rejects a non-finite discount (JSON 1e999 parses to Infinity)", async () => {
    expect(JSON.parse("1e999")).toBe(Infinity); // the payload really is Infinity
    const res = await post(bodyWith(`"discountType": "percent", "discountValue": 1e999,`));
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.splitId).toBeUndefined();
  });

  it("rejects a percent discount over 100 — the tip's 500 does not apply", async () => {
    const res = await post(bodyWith(`"discountType": "percent", "discountValue": 101,`));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("discount percent too large");
  });

  it("rejects a fractional amount discount (money is whole cents)", async () => {
    const res = await post(bodyWith(`"discountType": "amount", "discountValue": 450.5,`));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("discount must be whole cents");
  });

  it("rejects an amount discount over $100,000", async () => {
    const res = await post(bodyWith(`"discountType": "amount", "discountValue": 10000001,`));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("discount too large");
  });

  it("accepts a normal percent discount", async () => {
    const res = await post(bodyWith(`"discountType": "percent", "discountValue": 15,`));
    expect(res.status).toBe(200);
    expect(typeof res.body.splitId).toBe("string");
  });

  it("accepts a normal amount discount", async () => {
    const res = await post(bodyWith(`"discountType": "amount", "discountValue": 450,`));
    expect(res.status).toBe(200);
    expect(typeof res.body.splitId).toBe("string");
  });

  it("accepts the caps themselves", async () => {
    expect((await post(bodyWith(`"discountType": "percent", "discountValue": 100,`))).status).toBe(
      200,
    );
    expect(
      (await post(bodyWith(`"discountType": "amount", "discountValue": 10000000,`))).status,
    ).toBe(200);
  });

  it("accepts an amount bigger than the subtotal — compute time clamps it", async () => {
    // The $10.00 receipt above with a $500.00 coupon: allowed on purpose,
    // because the items can still change before anyone pays.
    const res = await post(bodyWith(`"discountType": "amount", "discountValue": 50000,`));
    expect(res.status).toBe(200);
    expect(typeof res.body.splitId).toBe("string");
  });

  it("accepts an explicit null type (no discount)", async () => {
    const res = await post(bodyWith(`"discountType": null, "discountValue": 0,`));
    expect(res.status).toBe(200);
    expect(typeof res.body.splitId).toBe("string");
  });

  it("accepts a payload with no discount fields at all", async () => {
    const res = await post(bodyWith(""));
    expect(res.status).toBe(200);
    expect(typeof res.body.splitId).toBe("string");
  });

  it("ignores an out-of-range value when no type makes it live", async () => {
    // No type means no discount, so the value is inert — but it still can't be
    // negative, which the field-level check above already covers.
    const res = await post(bodyWith(`"discountValue": 9000000,`));
    expect(res.status).toBe(200);
  });

  it("rejects an unknown discount type", async () => {
    const res = await post(bodyWith(`"discountType": "coupon", "discountValue": 10,`));
    expect(res.status).toBe(400);
    expect(res.body.splitId).toBeUndefined();
  });
});

describe("POST /api/splits — zero normalizes to no discount", () => {
  /** The stored discount pair, read straight back out of the room. */
  async function storedDiscount(splitId: unknown) {
    const state = await getRoomState(String(splitId));
    expect(state).not.toBeNull();
    return state!.split;
  }

  it("stores a type with no value as no discount at all", async () => {
    // ("amount", 0) is a ghost: the host dashboard reads it as a live discount
    // and opens its editor for a coupon nobody entered.
    const res = await post(bodyWith(`"discountType": "amount",`));
    expect(res.status).toBe(200);
    expect(await storedDiscount(res.body.splitId)).toMatchObject({
      discountType: null,
      discountValue: 0,
    });
  });

  it("stores an explicit zero as no discount at all", async () => {
    const res = await post(bodyWith(`"discountType": "percent", "discountValue": 0,`));
    expect(res.status).toBe(200);
    expect(await storedDiscount(res.body.splitId)).toMatchObject({
      discountType: null,
      discountValue: 0,
    });
  });

  it("still stores a real discount exactly as sent", async () => {
    const res = await post(bodyWith(`"discountType": "percent", "discountValue": 15,`));
    expect(res.status).toBe(200);
    expect(await storedDiscount(res.body.splitId)).toMatchObject({
      discountType: "percent",
      discountValue: 15,
    });
  });
});
