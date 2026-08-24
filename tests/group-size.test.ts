import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { computeSettlement } from "@/lib/split-math";
import type { SettlementInput } from "@/lib/split-math";
import { fr } from "@/lib/fraction";
import type { Claim, Participant, ReceiptItem, RoomState } from "@/lib/types";

/**
 * Declared group size. A sharedByAll item divides by max(groupSize, joiners),
 * so early joiners pay their final share from the first read — the not-yet-
 * joined remainder sits in the unclaimed bucket instead of being loaded onto
 * whoever happened to join first. No groupSize = the old joiners-only split.
 */

// ---- factories (matching split-math.test.ts) ----
function item(
  id: string,
  name: string,
  quantity: number,
  unitPriceCents: number,
  totalCents: number,
  sharedByAll = false,
  sortOrder = 0,
): ReceiptItem {
  return { id, name, quantity, unitPriceCents, totalCents, sharedByAll, sortOrder };
}
function person(id: string, name: string, isHost = false): Participant {
  return {
    id,
    name,
    isHost,
    isBirthday: false,
    paidStatus: "unpaid",
    joinedAt: "2026-01-01T00:00:00.000Z",
  };
}

const CAKE = [item("cake", "Cake", 1, 2500, 2500, true)];
const NO_CLAIMS: Claim[] = [];

function settle(participants: Participant[], groupSize?: number | null) {
  const input: SettlementInput = {
    items: CAKE,
    claims: NO_CLAIMS,
    participants,
    taxCents: 500,
    tipType: "percent",
    tipValue: 20,
    groupSize,
  };
  return computeSettlement(input);
}

describe("computeSettlement — declared group size on sharedByAll items", () => {
  it("splits by the declared size when fewer people have joined, remainder unclaimed", () => {
    const s = settle([person("A", "Alex", true), person("B", "Bailey"), person("C", "Casey")], 5);
    for (const p of s.people) {
      expect(p.lines[0].share).toEqual(fr(1, 5));
      expect(p.itemsCents).toBe(500); // 2500 / 5
      // Tax and tip ride the item weights: 500/2500 of 500¢ each.
      expect(p.taxCents).toBe(100);
      expect(p.tipCents).toBe(100);
      expect(p.totalCents).toBe(700);
    }
    // The two not-yet-joined fifths — items, tax, and tip — sit in unclaimed.
    expect(s.unclaimed.itemsCents).toBe(1000);
    expect(s.unclaimed.taxCents).toBe(200);
    expect(s.unclaimed.tipCents).toBe(200);
    expect(s.reconciles).toBe(true);
    expect(s.grandTotalCents).toBe(3500);
  });

  it("splits by joiners when more people joined than were declared", () => {
    const six = ["A", "B", "C", "D", "E", "F"].map((id) => person(id, id));
    const s = settle(six, 5);
    for (const p of s.people) {
      expect(p.lines[0].share).toEqual(fr(1, 6));
      expect([416, 417]).toContain(p.itemsCents);
    }
    expect(s.people.reduce((sum, p) => sum + p.itemsCents, 0)).toBe(2500);
    expect(s.unclaimed.itemsCents).toBe(0);
    expect(s.reconciles).toBe(true);
  });

  it("null and absent group size both mean the old joiners-only split", () => {
    const two = [person("A", "Alex", true), person("B", "Bailey")];
    const withNull = settle(two, null);
    const absent = settle(two, undefined);
    expect(withNull).toEqual(absent);
    for (const p of withNull.people) {
      expect(p.lines[0].share).toEqual(fr(1, 2));
      expect(p.itemsCents).toBe(1250);
    }
    expect(withNull.unclaimed.itemsCents).toBe(0);
  });

  it("a declared size equal to the joiners changes nothing", () => {
    const two = [person("A", "Alex", true), person("B", "Bailey")];
    expect(settle(two, 2)).toEqual(settle(two, null));
  });

  it("with zero joiners the shared item stays fully unclaimed, declared size or not", () => {
    const s = settle([], 5);
    expect(s.people).toHaveLength(0);
    expect(s.unclaimed.itemsCents).toBe(2500);
    expect(s.reconciles).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Route level — create, read back, and host PATCH                     */
/* ------------------------------------------------------------------ */

const dbFile = path.join(os.tmpdir(), `settle-group-size-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_FILE = dbFile;
delete process.env.DATABASE_URL;

const { POST } = await import("@/app/api/splits/route");
const { GET, PATCH } = await import("@/app/api/splits/[id]/route");
const { createSplit, joinParticipant } = await import("@/lib/store");

afterAll(() => {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* never created */
    }
  }
});

interface CreateBody {
  error?: string;
  splitId?: string;
  hostKey?: string;
}

/** Raw body string, so values JS can't literal-ize survive the round trip. */
async function create(raw: string): Promise<{ status: number; body: CreateBody }> {
  const res = await POST(
    new Request("http://localhost/api/splits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    }),
  );
  return { status: res.status, body: (await res.json()) as CreateBody };
}

const CREATE_BASE =
  `"hostName": "Ada", "tipType": "percent", "tipValue": 0, "taxCents": 0, ` +
  `"items": [{"name": "Cake", "quantity": 1, "unitPriceCents": 2500, "totalCents": 2500, "sharedByAll": true}]`;

async function readRoom(splitId: string): Promise<RoomState> {
  const res = await GET(new Request(`http://localhost/api/splits/${splitId}`), {
    params: Promise.resolve({ id: splitId }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as RoomState;
}

async function patch(
  splitId: string,
  hostKey: string,
  raw: string,
): Promise<{ status: number; body: RoomState & { error?: string } }> {
  const res = await PATCH(
    new Request(`http://localhost/api/splits/${splitId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-host-key": hostKey },
      body: raw,
    }),
    { params: Promise.resolve({ id: splitId }) },
  );
  return { status: res.status, body: (await res.json()) as RoomState & { error?: string } };
}

describe("POST /api/splits — groupSize validation", () => {
  it("stores a declared group size", async () => {
    const res = await create(`{${CREATE_BASE}, "groupSize": 5}`);
    expect(res.status).toBe(200);
    const room = await readRoom(res.body.splitId!);
    expect(room.split.groupSize).toBe(5);
  });

  it("defaults to null when absent", async () => {
    const res = await create(`{${CREATE_BASE}}`);
    expect(res.status).toBe(200);
    const room = await readRoom(res.body.splitId!);
    expect(room.split.groupSize).toBeNull();
  });

  it("rejects zero", async () => {
    const res = await create(`{${CREATE_BASE}, "groupSize": 0}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("group size must be at least 1");
  });

  it("rejects 100", async () => {
    const res = await create(`{${CREATE_BASE}, "groupSize": 100}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("group size too large");
  });

  it("rejects a fraction", async () => {
    const res = await create(`{${CREATE_BASE}, "groupSize": 1.5}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("group size must be a whole number");
  });

  it("rejects a string", async () => {
    const res = await create(`{${CREATE_BASE}, "groupSize": "abc"}`);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/splits/[id] — setting the group size after the fact", () => {
  /** A shared-cake room with the host plus one joiner. */
  async function cakeRoom() {
    const created = await createSplit({
      hostName: "Ada",
      tipType: "percent",
      tipValue: 0,
      taxCents: 0,
      items: [
        { name: "Cake", quantity: 1, unitPriceCents: 2500, totalCents: 2500, sharedByAll: true },
      ],
    });
    await joinParticipant(created.splitId, "Bo");
    return created;
  }

  it("re-splits shared items by the declared size, shortfall to unclaimed", async () => {
    const { splitId, hostKey } = await cakeRoom();

    const before = await readRoom(splitId);
    expect(before.split.groupSize).toBeNull();
    for (const p of before.settlement.people) expect(p.itemsCents).toBe(1250);

    const res = await patch(splitId, hostKey, `{"groupSize": 5}`);
    expect(res.status).toBe(200);
    expect(res.body.split.groupSize).toBe(5);
    for (const p of res.body.settlement.people) expect(p.itemsCents).toBe(500);
    expect(res.body.settlement.unclaimed.itemsCents).toBe(1500);
    expect(res.body.settlement.reconciles).toBe(true);
  });

  it("null clears it back to the joiners-only split", async () => {
    const { splitId, hostKey } = await cakeRoom();
    await patch(splitId, hostKey, `{"groupSize": 5}`);

    const res = await patch(splitId, hostKey, `{"groupSize": null}`);
    expect(res.status).toBe(200);
    expect(res.body.split.groupSize).toBeNull();
    for (const p of res.body.settlement.people) expect(p.itemsCents).toBe(1250);
    expect(res.body.settlement.unclaimed.itemsCents).toBe(0);
  });

  it("rejects an out-of-range size and stores nothing", async () => {
    const { splitId, hostKey } = await cakeRoom();
    const res = await patch(splitId, hostKey, `{"groupSize": 0}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("group size must be at least 1");
    expect((await readRoom(splitId)).split.groupSize).toBeNull();
  });

  it("keeps the host-key gate, exactly like tip edits", async () => {
    const { splitId } = await cakeRoom();
    const res = await patch(splitId, "wrong-key", `{"groupSize": 5}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("host key required");
    expect((await readRoom(splitId)).split.groupSize).toBeNull();
  });
});
