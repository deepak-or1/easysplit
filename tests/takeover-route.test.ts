import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fr } from "@/lib/fraction";
import type { RoomState } from "@/lib/types";

/**
 * POST /api/splits/[id]/claim — takeover, driven through the real route.
 *
 * Two things the store-level tests can't see. First, where the taker's identity
 * comes from: the action carries no participantId, so the route fills in the
 * body's top-level one — self-asserted, like every other claim action — and zod
 * strips any participantId smuggled into the action object. Second, that a
 * takeover is visible to the REST of its own batch: the item's sharedByAll is
 * cleared in the in-memory snapshot too, so a following action is judged
 * against the unshared item instead of the stale shared one.
 */

const dbFile = path.join(os.tmpdir(), `settle-takeover-route-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_FILE = dbFile;
delete process.env.DATABASE_URL;

const { POST } = await import("@/app/api/splits/[id]/claim/route");
const { applyActions, createSplit, getRoomState, joinParticipant } = await import("@/lib/store");

afterAll(() => {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* never created */
    }
  }
});

interface ClaimBody {
  error?: string;
  rejected?: { reason: string }[];
  state?: RoomState;
}

/** Grocery room: shared Coffee (qty 2), private Bananas (qty 1), host + guest. */
async function room(splitType: "grocery" | "restaurant" = "grocery") {
  const { splitId, hostParticipantId } = await createSplit({
    hostName: "Host",
    tipType: "percent",
    tipValue: 0,
    taxCents: 0,
    splitType,
    items: [
      { name: "Coffee", quantity: 2, unitPriceCents: 800, totalCents: 1600, sharedByAll: true },
      { name: "Bananas", quantity: 1, unitPriceCents: 300, totalCents: 300 },
    ],
  });
  const guest = await joinParticipant(splitId, "Guest");
  const state = (await getRoomState(splitId))!;
  return {
    splitId,
    hostId: hostParticipantId,
    guestId: guest.id,
    coffeeId: state.items[0].id,
    bananasId: state.items[1].id,
  };
}

/** Actions are plain objects so a test can send fields the schema will strip. */
async function claim(
  splitId: string,
  participantId: string,
  actions: Record<string, unknown>[],
): Promise<{ status: number; body: ClaimBody }> {
  const res = await POST(
    new Request(`http://localhost/api/splits/${splitId}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId, actions }),
    }),
    { params: Promise.resolve({ id: splitId }) },
  );
  return { status: res.status, body: (await res.json()) as ClaimBody };
}

function item(state: RoomState, itemId: string) {
  return state.items.find((i) => i.id === itemId)!;
}

describe("takeover — identity comes from the body's top-level participantId", () => {
  it("gives the item to the participant named at the top level", async () => {
    const { splitId, guestId, coffeeId } = await room();

    const res = await claim(splitId, guestId, [{ type: "takeover", itemId: coffeeId }]);
    expect(res.status).toBe(200);
    expect(res.body.rejected).toEqual([]);

    const coffee = item(res.body.state!, coffeeId);
    expect(coffee.sharedByAll).toBe(false);
    expect(coffee.claims).toHaveLength(1);
    expect(coffee.claims[0].participantId).toBe(guestId);
    expect(coffee.claims[0].share).toEqual(fr(2));
  });

  it("ignores a participantId smuggled into the action object", async () => {
    const { splitId, hostId, guestId, coffeeId } = await room();

    // zod strips the unknown key, so the takeover still binds to the guest.
    const res = await claim(splitId, guestId, [
      { type: "takeover", itemId: coffeeId, participantId: hostId },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.rejected).toEqual([]);

    const coffee = item(res.body.state!, coffeeId);
    expect(coffee.claims).toHaveLength(1);
    expect(coffee.claims[0].participantId).toBe(guestId);
  });

  it("rejects a takeover from someone who isn't in the room", async () => {
    const { splitId, coffeeId } = await room();
    const res = await claim(splitId, "ghost", [{ type: "takeover", itemId: coffeeId }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unknown participant");
    expect(item((await getRoomState(splitId))!, coffeeId).sharedByAll).toBe(true);
  });
});

describe("takeover — visible to the rest of its own batch", () => {
  it("lets a later set in the same batch claim the now-unshared item", async () => {
    const { splitId, hostId, guestId, coffeeId } = await room();

    // Same request: take the coffee, then hand one of the two to the host.
    const res = await claim(splitId, guestId, [
      { type: "takeover", itemId: coffeeId },
      { type: "set", itemId: coffeeId, participantId: guestId, share: { n: 1, d: 1 } },
      { type: "set", itemId: coffeeId, participantId: hostId, share: { n: 1, d: 1 } },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.rejected).toEqual([]);

    const coffee = item(res.body.state!, coffeeId);
    expect(coffee.sharedByAll).toBe(false);
    expect(coffee.claims).toHaveLength(2);
    expect(coffee.claims.find((c) => c.participantId === guestId)!.share).toEqual(fr(1));
    expect(coffee.claims.find((c) => c.participantId === hostId)!.share).toEqual(fr(1));
  });

  it("lets a later split in the same batch divide the now-unshared item", async () => {
    const { splitId, hostId, guestId, coffeeId } = await room();

    const res = await claim(splitId, guestId, [
      { type: "takeover", itemId: coffeeId },
      { type: "split", itemId: coffeeId, participantIds: [guestId, hostId] },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.rejected).toEqual([]);

    const coffee = item(res.body.state!, coffeeId);
    expect(coffee.sharedByAll).toBe(false);
    expect(coffee.claims).toHaveLength(2);
    expect(coffee.claims.every((c) => c.share.n / c.share.d === 1)).toBe(true);
  });

  it("rejects a follow-up over-claim for the real reason, not a stale 'shared' one", async () => {
    const { splitId, hostId, guestId, coffeeId } = await room();

    const res = await claim(splitId, guestId, [
      { type: "takeover", itemId: coffeeId },
      { type: "set", itemId: coffeeId, participantId: hostId, share: { n: 1, d: 1 } },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected![0].reason).toMatch(/already fully claimed/i);
    expect(res.body.rejected![0].reason).not.toMatch(/shared by the whole table/i);
  });

  it("rejects a second takeover of the same item in the same batch", async () => {
    const { splitId, guestId, coffeeId } = await room();

    const res = await claim(splitId, guestId, [
      { type: "takeover", itemId: coffeeId },
      { type: "takeover", itemId: coffeeId },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected![0].reason).toMatch(/isn't shared by everyone/i);

    const coffee = item(res.body.state!, coffeeId);
    expect(coffee.claims).toHaveLength(1);
    expect(coffee.claims[0].participantId).toBe(guestId);
  });
});

describe("takeover — two takers in one batch (store level)", () => {
  it("rejects the second taker instead of silently overwriting the first", async () => {
    // The route binds every takeover in a request to one participant, so two
    // DIFFERENT takers in a single batch can only arrive through the store —
    // the SMS/parser path shares this entry point.
    const { splitId, hostId, guestId, coffeeId } = await room();

    const result = await applyActions(splitId, [
      { type: "takeover", itemId: coffeeId, participantId: guestId },
      { type: "takeover", itemId: coffeeId, participantId: hostId },
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/isn't shared by everyone/i);

    const coffee = item((await getRoomState(splitId))!, coffeeId);
    expect(coffee.sharedByAll).toBe(false);
    expect(coffee.claims).toHaveLength(1);
    expect(coffee.claims[0].participantId).toBe(guestId); // first taker wins
  });
});
