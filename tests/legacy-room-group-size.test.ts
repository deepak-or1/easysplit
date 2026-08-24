import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import type { RoomState } from "@/lib/types";

/**
 * A room created BEFORE the group_size column shipped: the row predates the
 * column entirely, the boot-time additive migration adds it as NULL, and the
 * host can then declare a headcount through the ordinary PATCH. This is the
 * real upgrade path for every live room, driven end to end — legacy DB file,
 * migration, then the handlers.
 */

const dbFile = path.join(os.tmpdir(), `settle-legacy-group-${process.pid}-${Date.now()}.db`);

// Build the legacy database first, before the app ever sees the file: today's
// schema with group_size dropped again is byte-faithful to the pre-feature
// shape, and the raw insert below is a room exactly as an old deploy wrote it.
{
  const raw = new Database(dbFile);
  raw.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  raw.exec("ALTER TABLE splits DROP COLUMN group_size");
  raw
    .prepare(
      `INSERT INTO splits (id, host_key, restaurant_name, host_name, tip_type, tip_value, tax_cents)
       VALUES ('legacy1', 'legacy-host-key', 'BUOY', 'Maya', 'percent', 0, 0)`,
    )
    .run();
  raw.prepare(`INSERT INTO receipts (id, split_id) VALUES ('r1', 'legacy1')`).run();
  raw
    .prepare(
      `INSERT INTO receipt_items (id, receipt_id, name, quantity, unit_price_cents, total_cents, shared_by_all)
       VALUES ('cake', 'r1', 'Cake', 1, 2500, 2500, 1)`,
    )
    .run();
  raw
    .prepare(
      `INSERT INTO participants (id, split_id, name, is_host) VALUES ('p1', 'legacy1', 'Maya', 1)`,
    )
    .run();
  raw
    .prepare(
      `INSERT INTO participants (id, split_id, name, is_host) VALUES ('p2', 'legacy1', 'Sam', 0)`,
    )
    .run();
  raw.close();
}

process.env.DATABASE_FILE = dbFile;
delete process.env.DATABASE_URL;

const { GET, PATCH } = await import("@/app/api/splits/[id]/route");

afterAll(() => {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* never created */
    }
  }
});

async function readRoom(): Promise<RoomState> {
  const res = await GET(new Request("http://localhost/api/splits/legacy1"), {
    params: Promise.resolve({ id: "legacy1" }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as RoomState;
}

async function patch(raw: string, hostKey = "legacy-host-key") {
  const res = await PATCH(
    new Request("http://localhost/api/splits/legacy1", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-host-key": hostKey },
      body: raw,
    }),
    { params: Promise.resolve({ id: "legacy1" }) },
  );
  return { status: res.status, body: (await res.json()) as RoomState & { error?: string } };
}

describe("a room from before the group_size column existed", () => {
  it("migrates to a null group size and keeps its old joiners-only split", async () => {
    const room = await readRoom();
    expect(room.split.groupSize).toBeNull();
    for (const p of room.settlement.people) expect(p.itemsCents).toBe(1250);
    expect(room.settlement.unclaimed.itemsCents).toBe(0);
  });

  it("lets the host declare a headcount after the fact", async () => {
    const res = await patch(`{"groupSize": 5}`);
    expect(res.status).toBe(200);
    expect(res.body.split.groupSize).toBe(5);
    for (const p of res.body.settlement.people) expect(p.itemsCents).toBe(500);
    expect(res.body.settlement.unclaimed.itemsCents).toBe(1500);
    expect(res.body.settlement.reconciles).toBe(true);
  });

  it("still refuses the edit without the host key", async () => {
    const res = await patch(`{"groupSize": 3}`, "wrong-key");
    expect(res.status).toBe(401);
  });
});
