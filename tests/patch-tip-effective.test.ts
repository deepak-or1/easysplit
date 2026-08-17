import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { TipType } from "@/lib/types";

/**
 * PATCH /api/splits/[id] — tip bounds against the EFFECTIVE (stored + patched)
 * pair, not just the patch.
 *
 * A patch is partial, so the schema alone could be walked around two ways:
 * send `{tipValue: 10000000}` with no `tipType` on a percent room (the amount
 * cap gets applied to a number the room will read as a percent), or send a bare
 * `{tipType: "percent"}` to flip a stored amount into a percent. Either lands a
 * tip that computeTipCents turns into an absurd — or infinite — total. Driven
 * through the real handler: the schema is module-private.
 */

const dbFile = path.join(os.tmpdir(), `settle-patch-tip-${process.pid}-${Date.now()}.db`);
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
  split?: { tipType: TipType; tipValue: number; restaurantName: string | null };
}

/** A one-item room with the given stored tip. */
async function room(tipType: TipType, tipValue: number) {
  return createSplit({
    hostName: "Ada",
    tipType,
    tipValue,
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

describe("PATCH tip bounds — tipValue without tipType", () => {
  it("rejects an amount-sized tipValue on a percent room", async () => {
    const { splitId, hostKey } = await room("percent", 20);
    const res = await patch(splitId, hostKey, `{"tipValue": 10000000}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tip percent too large");
    expect(await stored(splitId, hostKey)).toMatchObject({ tipType: "percent", tipValue: 20 });
  });

  it("rejects a percent just over the cap on a percent room", async () => {
    const { splitId, hostKey } = await room("percent", 20);
    const res = await patch(splitId, hostKey, `{"tipValue": 501}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tip percent too large");
  });

  it("still applies a normal percent tip", async () => {
    const { splitId, hostKey } = await room("percent", 20);
    const res = await patch(splitId, hostKey, `{"tipValue": 25}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ tipType: "percent", tipValue: 25 });
  });

  it("accepts the percent cap itself", async () => {
    const { splitId, hostKey } = await room("percent", 20);
    const res = await patch(splitId, hostKey, `{"tipValue": 500}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ tipValue: 500 });
  });

  it("still rejects an over-cap amount on an amount room", async () => {
    const { splitId, hostKey } = await room("amount", 1500);
    const res = await patch(splitId, hostKey, `{"tipValue": 10000001}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tip too large");
  });

  it("applies a normal amount tip on an amount room", async () => {
    const { splitId, hostKey } = await room("amount", 1500);
    const res = await patch(splitId, hostKey, `{"tipValue": 2500}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ tipType: "amount", tipValue: 2500 });
  });
});

describe("PATCH tip bounds — tipType flip without tipValue", () => {
  it("rejects flipping to percent when the stored amount exceeds the percent cap", async () => {
    const { splitId, hostKey } = await room("amount", 10_000_000);
    const res = await patch(splitId, hostKey, `{"tipType": "percent"}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tip percent too large");
    expect(await stored(splitId, hostKey)).toMatchObject({
      tipType: "amount",
      tipValue: 10_000_000,
    });
  });

  it("rejects flipping to amount when the stored percent isn't whole cents", async () => {
    const { splitId, hostKey } = await room("percent", 20.5);
    const res = await patch(splitId, hostKey, `{"tipType": "amount"}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tip must be whole cents");
    expect(await stored(splitId, hostKey)).toMatchObject({ tipType: "percent", tipValue: 20.5 });
  });

  it("allows a flip the stored value survives", async () => {
    const { splitId, hostKey } = await room("percent", 500);
    const res = await patch(splitId, hostKey, `{"tipType": "amount"}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ tipType: "amount", tipValue: 500 });
  });

  it("allows a flip that carries its own value", async () => {
    const { splitId, hostKey } = await room("percent", 20);
    const res = await patch(splitId, hostKey, `{"tipType": "amount", "tipValue": 1500}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ tipType: "amount", tipValue: 1500 });
  });

  it("rejects a flip whose own value breaks the new type", async () => {
    const { splitId, hostKey } = await room("amount", 1500);
    const res = await patch(splitId, hostKey, `{"tipType": "percent", "tipValue": 900}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tip percent too large");
  });

  it("rescues an over-cap stored amount by flipping type and value together", async () => {
    const { splitId, hostKey } = await room("amount", 10_000_000);
    const res = await patch(splitId, hostKey, `{"tipType": "percent", "tipValue": 18}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({ tipType: "percent", tipValue: 18 });
  });
});

describe("PATCH tip bounds — patches that don't touch the tip", () => {
  it("leaves an unrelated patch alone", async () => {
    const { splitId, hostKey } = await room("percent", 20);
    const res = await patch(splitId, hostKey, `{"restaurantName": "Taqueria"}`);
    expect(res.status).toBe(200);
    expect(res.body.split).toMatchObject({
      restaurantName: "Taqueria",
      tipType: "percent",
      tipValue: 20,
    });
  });

  it("keeps the host-key gate ahead of the check", async () => {
    const { splitId } = await room("percent", 20);
    const res = await patch(splitId, "wrong-key", `{"tipValue": 10000000}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("host key required");
  });
});
