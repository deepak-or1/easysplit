import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { DiscountType } from "@/lib/types";

/**
 * PATCH /api/splits/[id] — discount bounds against the EFFECTIVE (stored +
 * patched) pair, the same two-layer treatment the tip gets.
 *
 * A patch is partial, so the schema alone could be walked around two ways:
 * send `{discountValue: 9000000}` with no type on a percent room (the amount
 * cap gets applied to a number the room will read as a percent), or send a bare
 * `{discountType: "percent"}` to flip a stored amount into a percent. Driven
 * through the real handler: the schema is module-private.
 */

const dbFile = path.join(os.tmpdir(), `settle-patch-discount-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_FILE = dbFile;
delete process.env.DATABASE_URL;

const { PATCH } = await import("@/app/api/splits/[id]/route");
const { createSplit } = await import("@/lib/store");

afterAll(() => {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* never created */
    }
  }
});

interface PatchBody {
  error?: string;
  split?: {
    discountType: DiscountType | null;
    discountValue: number;
    restaurantName: string | null;
  };
  settlement?: { discountCents: number; grandTotalCents: number };
}

/** A one-item ($10.00) room with the given stored discount. */
async function room(discountType: DiscountType | null, discountValue: number) {
  return createSplit({
    hostName: "Ada",
    tipType: "percent",
    tipValue: 0,
    discountType,
    discountValue,
    taxCents: 0,
    items: [{ name: "Tacos", quantity: 1, unitPriceCents: 1000, totalCents: 1000 }],
  });
}

/** Raw body string, so values JS can't literal-ize survive the round trip. */
async function patch(
  splitId: string,
  hostKey: string,
  raw: string,
): Promise<{ status: number; body: PatchBody }> {
  const res = await PATCH(
    new Request(`http://localhost/api/splits/${splitId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-host-key": hostKey },
      body: raw,
    }),
    { params: Promise.resolve({ id: splitId }) },
  );
  return { status: res.status, body: (await res.json()) as PatchBody };
}

/** Read the room back through a no-op patch — cheapest way to assert storage. */
async function stored(splitId: string, hostKey: string) {
  const res = await patch(splitId, hostKey, "{}");
  expect(res.status).toBe(200);
  return res.body.split!;
}

describe("createSplit — discount round-trip", () => {
  it("stores and reads back the discount, and the settlement uses it", async () => {
    const { splitId, hostKey } = await room("percent", 15);
    const res = await patch(splitId, hostKey, "{}");
    expect(res.body.split).toMatchObject({ discountType: "percent", discountValue: 15 });
    expect(res.body.settlement?.discountCents).toBe(150);
    expect(res.body.settlement?.grandTotalCents).toBe(850);
  });

  it("defaults to no discount when the fields are omitted at creation", async () => {
    const { splitId, hostKey } = await createSplit({
      hostName: "Ada",
      tipType: "percent",
      tipValue: 0,
      taxCents: 0,
      items: [{ name: "Tacos", quantity: 1, unitPriceCents: 1000, totalCents: 1000 }],
    });
    const res = await patch(splitId, hostKey, "{}");
    expect(res.body.split).toMatchObject({ discountType: null, discountValue: 0 });
    expect(res.body.settlement?.discountCents).toBe(0);
  });
});

describe("PATCH discount bounds — discountValue without discountType", () => {
  it("rejects an amount-sized discountValue on a percent room", async () => {
    const { splitId, hostKey } = await room("percent", 15);
    const res = await patch(splitId, hostKey, `{"discountValue": 9000000}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("discount percent too large");
    expect(await stored(splitId, hostKey)).toMatchObject({
      discountType: "percent",
      discountValue: 15,
    });
  });

  it("rejects a percent just over the cap on a percent room", async () => {
    const { splitId, hostKey } = await room("percent", 15);
    const res = await patch(splitId, hostKey, `{"discountValue": 101}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("discount percent too large");
  });

  it("still applies a normal percent discount", async () => {
    const { splitId, hostKey } = await room("percent", 15);
    const res = await patch(splitId, hostKey, `{"discountValue": 25}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountType: "percent", discountValue: 25 });
    expect(res.body.settlement?.discountCents).toBe(250);
  });

  it("accepts the percent cap itself", async () => {
    const { splitId, hostKey } = await room("percent", 15);
    const res = await patch(splitId, hostKey, `{"discountValue": 100}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountValue: 100 });
    // 100% off a $10 receipt with no tax or tip: nothing left to pay.
    expect(res.body.settlement?.grandTotalCents).toBe(0);
  });

  it("still rejects an over-cap amount on an amount room", async () => {
    const { splitId, hostKey } = await room("amount", 450);
    const res = await patch(splitId, hostKey, `{"discountValue": 10000001}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("discount too large");
  });

  it("rejects a fractional value on an amount room", async () => {
    const { splitId, hostKey } = await room("amount", 450);
    const res = await patch(splitId, hostKey, `{"discountValue": 450.5}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("discount must be whole cents");
  });

  it("applies a normal amount discount on an amount room", async () => {
    const { splitId, hostKey } = await room("amount", 450);
    const res = await patch(splitId, hostKey, `{"discountValue": 250}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountType: "amount", discountValue: 250 });
    expect(res.body.settlement?.discountCents).toBe(250);
  });

  it("accepts an amount past the subtotal and clamps it in the settlement", async () => {
    const { splitId, hostKey } = await room("amount", 450);
    const res = await patch(splitId, hostKey, `{"discountValue": 50000}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountValue: 50000 });
    expect(res.body.settlement?.discountCents).toBe(1000); // the whole $10 subtotal
    expect(res.body.settlement?.grandTotalCents).toBe(0);
  });

  it("leaves a value alone on a room with no discount at all", async () => {
    const { splitId, hostKey } = await room(null, 0);
    const res = await patch(splitId, hostKey, `{"discountValue": 9000000}`);
    // No type means no discount — the value is stored but inert.
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountType: null });
    expect(res.body.settlement?.discountCents).toBe(0);
  });
});

describe("PATCH discount bounds — discountType flip without discountValue", () => {
  it("rejects flipping to percent when the stored amount exceeds the percent cap", async () => {
    const { splitId, hostKey } = await room("amount", 450);
    const res = await patch(splitId, hostKey, `{"discountType": "percent"}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("discount percent too large");
    expect(await stored(splitId, hostKey)).toMatchObject({
      discountType: "amount",
      discountValue: 450,
    });
  });

  it("rejects flipping to amount when the stored percent isn't whole cents", async () => {
    const { splitId, hostKey } = await room("percent", 12.5);
    const res = await patch(splitId, hostKey, `{"discountType": "amount"}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("discount must be whole cents");
    expect(await stored(splitId, hostKey)).toMatchObject({
      discountType: "percent",
      discountValue: 12.5,
    });
  });

  it("rejects turning ON a discount whose stored value breaks the new type", async () => {
    // A room with no discount can still carry a leftover value; switching the
    // type on has to be judged against it.
    const { splitId, hostKey } = await room(null, 9_000_000);
    const res = await patch(splitId, hostKey, `{"discountType": "percent"}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("discount percent too large");
  });

  it("allows a flip the stored value survives", async () => {
    const { splitId, hostKey } = await room("percent", 100);
    const res = await patch(splitId, hostKey, `{"discountType": "amount"}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountType: "amount", discountValue: 100 });
  });

  it("allows a flip that carries its own value", async () => {
    const { splitId, hostKey } = await room("percent", 15);
    const res = await patch(splitId, hostKey, `{"discountType": "amount", "discountValue": 450}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountType: "amount", discountValue: 450 });
  });

  it("rejects a flip whose own value breaks the new type", async () => {
    const { splitId, hostKey } = await room("amount", 450);
    const res = await patch(splitId, hostKey, `{"discountType": "percent", "discountValue": 150}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("discount percent too large");
  });

  it("rescues an over-cap stored amount by flipping type and value together", async () => {
    const { splitId, hostKey } = await room("amount", 9_000_000);
    const res = await patch(splitId, hostKey, `{"discountType": "percent", "discountValue": 15}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountType: "percent", discountValue: 15 });
  });
});

describe("PATCH discount — clearing", () => {
  it("null clears the discount entirely", async () => {
    const { splitId, hostKey } = await room("percent", 15);
    const res = await patch(splitId, hostKey, `{"discountType": null, "discountValue": 0}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountType: null, discountValue: 0 });
    expect(res.body.settlement?.discountCents).toBe(0);
    expect(res.body.settlement?.grandTotalCents).toBe(1000);
  });

  it("null clears it even when the stored value would be out of bounds", async () => {
    // Removing a discount must never be blocked by the value it's removing.
    const { splitId, hostKey } = await room("amount", 9_000_000);
    const res = await patch(splitId, hostKey, `{"discountType": null}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountType: null });
    expect(res.body.settlement?.discountCents).toBe(0);
  });

  it("null clears it even when the patch carries an over-cap value of its own", async () => {
    // The value rides along inert — it is not a reason to refuse the removal.
    const { splitId, hostKey } = await room("amount", 450);
    const res = await patch(splitId, hostKey, `{"discountType": null, "discountValue": 20000000}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountType: null });
    expect(res.body.settlement?.discountCents).toBe(0);
    expect(res.body.settlement?.grandTotalCents).toBe(1000);
  });
});

describe("PATCH discount — zero normalizes to none", () => {
  it("stores a zeroed percent discount as no discount at all", async () => {
    // A 0% discount IS no discount; storing ("percent", 0) leaves a ghost the
    // host editor reads as live and auto-expands for.
    const { splitId, hostKey } = await room("percent", 15);
    const res = await patch(splitId, hostKey, `{"discountValue": 0}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountType: null, discountValue: 0 });
    expect(res.body.settlement?.discountCents).toBe(0);
    expect(await stored(splitId, hostKey)).toMatchObject({
      discountType: null,
      discountValue: 0,
    });
  });

  it("stores a zeroed amount discount as no discount at all", async () => {
    const { splitId, hostKey } = await room("amount", 450);
    const res = await patch(splitId, hostKey, `{"discountType": "amount", "discountValue": 0}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountType: null, discountValue: 0 });
    expect(res.body.settlement?.discountCents).toBe(0);
  });

  it("still stores a real discount untouched", async () => {
    const { splitId, hostKey } = await room("percent", 15);
    const res = await patch(splitId, hostKey, `{"discountValue": 20}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ discountType: "percent", discountValue: 20 });
  });
});

describe("PATCH discount — patches that don't touch it", () => {
  it("leaves an unrelated patch alone", async () => {
    const { splitId, hostKey } = await room("percent", 15);
    const res = await patch(splitId, hostKey, `{"restaurantName": "Taqueria"}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({
      restaurantName: "Taqueria",
      discountType: "percent",
      discountValue: 15,
    });
  });

  it("keeps the host-key gate ahead of the check", async () => {
    const { splitId } = await room("percent", 15);
    const res = await patch(splitId, "wrong-key", `{"discountValue": 9000000}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("host key required");
  });

  it("still enforces the tip bounds alongside the discount ones", async () => {
    const { splitId, hostKey } = await room("percent", 15);
    const res = await patch(splitId, hostKey, `{"tipValue": 501, "discountValue": 20}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tip percent too large");
    // Rejected as a unit: neither field lands.
    expect(await stored(splitId, hostKey)).toMatchObject({ discountValue: 15 });
  });
});
