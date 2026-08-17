import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * POST /api/splits — tip bounds.
 *
 * An unbounded `tipValue` used to be fatal: `tipValue: 1e308` with
 * `tipType: "percent"` passed validation, then computeTipCents multiplied it by
 * the subtotal to Infinity, and every later read of the room threw inside
 * allocate(). The schema is module-private (Next type-checks route files and
 * rejects non-handler exports), so these drive the real handler.
 */

const dbFile = path.join(os.tmpdir(), `settle-tip-bounds-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_FILE = dbFile;
delete process.env.DATABASE_URL;

const { POST } = await import("@/app/api/splits/route");

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
function bodyWith(tipType: string, tipValueJson: string): string {
  return `{
    "hostName": "Ada",
    "tipType": "${tipType}",
    "tipValue": ${tipValueJson},
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

describe("POST /api/splits — tipValue bounds", () => {
  it("rejects a percent tip of 1e308 (the value that poisoned the room)", async () => {
    const res = await post(bodyWith("percent", "1e308"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tip percent too large");
    expect(res.body.splitId).toBeUndefined();
  });

  it("rejects a non-finite percent tip (JSON 1e999 parses to Infinity)", async () => {
    expect(JSON.parse("1e999")).toBe(Infinity); // the payload really is Infinity
    const res = await post(bodyWith("percent", "1e999"));
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.splitId).toBeUndefined();
  });

  it("rejects a percent tip just over the cap", async () => {
    const res = await post(bodyWith("percent", "501"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tip percent too large");
  });

  it("rejects a fractional amount tip (tips are whole cents)", async () => {
    const res = await post(bodyWith("amount", "1500.5"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tip must be whole cents");
  });

  it("rejects an amount tip over $100,000", async () => {
    const res = await post(bodyWith("amount", "10000001"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tip too large");
  });

  it("still rejects a negative tip", async () => {
    const res = await post(bodyWith("percent", "-1"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tip can't be negative");
  });

  it("accepts a normal percent tip", async () => {
    const res = await post(bodyWith("percent", "20"));
    expect(res.status).toBe(200);
    expect(typeof res.body.splitId).toBe("string");
  });

  it("accepts a normal amount tip", async () => {
    const res = await post(bodyWith("amount", "1500"));
    expect(res.status).toBe(200);
    expect(typeof res.body.splitId).toBe("string");
  });

  it("accepts the caps themselves", async () => {
    expect((await post(bodyWith("percent", "500"))).status).toBe(200);
    expect((await post(bodyWith("amount", "10000000"))).status).toBe(200);
  });
});
