import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fr } from "@/lib/fraction";

/**
 * Grocery splits let one person take over an item the whole room is sharing —
 * "actually that coffee is just mine". It is the only action allowed to touch
 * a sharedByAll item, so it is gated twice: the split must be a grocery split,
 * and the item must currently be shared. Driven through the real store so the
 * unshare and the claim rewrite are checked as one transaction.
 */

const dbFile = path.join(os.tmpdir(), `settle-grocery-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_FILE = dbFile;
delete process.env.DATABASE_URL;

const { applyActions, createSplit, getRoomState, joinParticipant, replaceItems } = await import(
  "@/lib/store"
);

afterAll(() => {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* never created */
    }
  }
});

/** A room with one shared item and one private item, plus a guest. */
async function room(splitType?: "restaurant" | "grocery") {
  const { splitId, hostParticipantId } = await createSplit({
    hostName: "Host",
    tipType: "percent",
    tipValue: 0,
    taxCents: 0,
    ...(splitType ? { splitType } : {}),
    items: [
      { name: "Coffee", quantity: 2, unitPriceCents: 800, totalCents: 1600, sharedByAll: true },
      { name: "Bananas", quantity: 1, unitPriceCents: 300, totalCents: 300 },
    ],
  });
  const guest = await joinParticipant(splitId, "Guest");
  const state = await getRoomState(splitId);
  return {
    splitId,
    hostParticipantId,
    guestId: guest.id,
    sharedItemId: state!.items[0].id,
    privateItemId: state!.items[1].id,
  };
}

describe("createSplit — splitType", () => {
  it("defaults to 'restaurant' when the caller says nothing (the SMS path)", async () => {
    const { splitId } = await room();
    const state = await getRoomState(splitId);
    expect(state!.split.splitType).toBe("restaurant");
  });

  it("round-trips an explicit 'grocery' through room state", async () => {
    const { splitId } = await room("grocery");
    const state = await getRoomState(splitId);
    expect(state!.split.splitType).toBe("grocery");
  });

  it("round-trips an explicit 'restaurant' through room state", async () => {
    const { splitId } = await room("restaurant");
    const state = await getRoomState(splitId);
    expect(state!.split.splitType).toBe("restaurant");
  });
});

describe("takeover — grocery split, shared item", () => {
  it("unshares the item and gives the whole quantity to the taker", async () => {
    const { splitId, guestId, sharedItemId } = await room("grocery");

    const before = await getRoomState(splitId);
    expect(before!.items[0].sharedByAll).toBe(true);

    const result = await applyActions(splitId, [
      { type: "takeover", itemId: sharedItemId, participantId: guestId },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.unsharedItemIds).toEqual([sharedItemId]);
    expect(result.changedItemIds).toEqual([sharedItemId]);

    const after = await getRoomState(splitId);
    const taken = after!.items[0];
    expect(taken.sharedByAll).toBe(false);
    expect(taken.claims).toHaveLength(1);
    expect(taken.claims[0].participantId).toBe(guestId);
    expect(taken.claims[0].share).toEqual(fr(2)); // full quantity
    expect(taken.claimedShare).toEqual(fr(2));
    expect(taken.remaining).toEqual(fr(0));
  });

  it("charges the whole line to the taker and nobody else", async () => {
    const { splitId, guestId, hostParticipantId, sharedItemId } = await room("grocery");
    await applyActions(splitId, [
      { type: "takeover", itemId: sharedItemId, participantId: guestId },
    ]);

    const s = (await getRoomState(splitId))!.settlement;
    const guest = s.people.find((p) => p.participantId === guestId)!;
    const host = s.people.find((p) => p.participantId === hostParticipantId)!;
    expect(guest.itemsCents).toBe(1600);
    expect(host.itemsCents).toBe(0);
    expect(s.reconciles).toBe(true);
  });

  it("clears claims someone else had stored on the item", async () => {
    // Stored claims CAN outlive a switch to sharedByAll: the host claims the
    // bananas, then flips the item to shared, and replaceItems keeps the claim
    // (it still fits the quantity). Room state hides it while shared, but the
    // row is there — and the takeover has to sweep it.
    const { splitId, guestId, hostParticipantId, privateItemId } = await room("grocery");
    await applyActions(splitId, [
      { type: "set", itemId: privateItemId, participantId: hostParticipantId, share: fr(1) },
    ]);
    await replaceItems(splitId, [
      { name: "Coffee", quantity: 2, unitPriceCents: 800, totalCents: 1600, sharedByAll: true },
      {
        id: privateItemId,
        name: "Bananas",
        quantity: 1,
        unitPriceCents: 300,
        totalCents: 300,
        sharedByAll: true,
      },
    ]);

    const shared = (await getRoomState(splitId))!.items.find((i) => i.id === privateItemId)!;
    expect(shared.sharedByAll).toBe(true);

    const result = await applyActions(splitId, [
      { type: "takeover", itemId: privateItemId, participantId: guestId },
    ]);
    expect(result.rejected).toEqual([]);

    const after = (await getRoomState(splitId))!.items.find((i) => i.id === privateItemId)!;
    expect(after.sharedByAll).toBe(false);
    expect(after.claims).toHaveLength(1); // the host's claim is gone
    expect(after.claims[0].participantId).toBe(guestId);
    expect(after.claims[0].share).toEqual(fr(1));
  });

  it("refuses a second takeover, since the item is no longer shared", async () => {
    const { splitId, guestId, hostParticipantId, sharedItemId } = await room("grocery");
    await applyActions(splitId, [
      { type: "takeover", itemId: sharedItemId, participantId: hostParticipantId },
    ]);
    const second = await applyActions(splitId, [
      { type: "takeover", itemId: sharedItemId, participantId: guestId },
    ]);
    expect(second.rejected).toHaveLength(1);
    expect(second.rejected[0].reason).toMatch(/isn't shared by everyone/i);

    const after = await getRoomState(splitId);
    expect(after!.items[0].claims).toHaveLength(1);
    expect(after!.items[0].claims[0].participantId).toBe(hostParticipantId);
  });

  it("leaves the item claimable by the normal rules afterwards", async () => {
    const { splitId, guestId, hostParticipantId, sharedItemId } = await room("grocery");
    await applyActions(splitId, [
      { type: "takeover", itemId: sharedItemId, participantId: guestId },
    ]);
    // Fully claimed by the taker, so the host over-claims and is rejected.
    const over = await applyActions(splitId, [
      { type: "set", itemId: sharedItemId, participantId: hostParticipantId, share: fr(1) },
    ]);
    expect(over.rejected).toHaveLength(1);
    expect(over.rejected[0].reason).toMatch(/already fully claimed/i);

    // The taker can hand it back.
    const undo = await applyActions(splitId, [
      { type: "unclaim", itemId: sharedItemId, participantId: guestId },
    ]);
    expect(undo.rejected).toEqual([]);
    expect((await getRoomState(splitId))!.items[0].claims).toHaveLength(0);
  });
});

describe("takeover — rejections", () => {
  it("rejects taking over an item that isn't shared", async () => {
    const { splitId, guestId, privateItemId } = await room("grocery");

    const result = await applyActions(splitId, [
      { type: "takeover", itemId: privateItemId, participantId: guestId },
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/isn't shared by everyone/i);
    expect(result.unsharedItemIds).toEqual([]);
    expect(result.changedItemIds).toEqual([]);

    const after = await getRoomState(splitId);
    expect(after!.items[1].claims).toHaveLength(0);
    expect(after!.items[1].sharedByAll).toBe(false);
  });

  it("rejects takeover in a restaurant split, leaving the item shared", async () => {
    const { splitId, guestId, sharedItemId } = await room("restaurant");

    const result = await applyActions(splitId, [
      { type: "takeover", itemId: sharedItemId, participantId: guestId },
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/grocery splits/i);
    expect(result.unsharedItemIds).toEqual([]);

    const after = await getRoomState(splitId);
    expect(after!.items[0].sharedByAll).toBe(true);
    expect(after!.items[0].claims).toHaveLength(0);
  });

  it("rejects takeover in a split created without a splitType (defaults restaurant)", async () => {
    const { splitId, guestId, sharedItemId } = await room();

    const result = await applyActions(splitId, [
      { type: "takeover", itemId: sharedItemId, participantId: guestId },
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/grocery splits/i);
    expect((await getRoomState(splitId))!.items[0].sharedByAll).toBe(true);
  });

  it("rejects an unknown item", async () => {
    const { splitId, guestId } = await room("grocery");
    const result = await applyActions(splitId, [
      { type: "takeover", itemId: "nope", participantId: guestId },
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/isn't on the receipt/i);
  });

  it("rejects an unknown participant", async () => {
    const { splitId, sharedItemId } = await room("grocery");
    const result = await applyActions(splitId, [
      { type: "takeover", itemId: sharedItemId, participantId: "ghost" },
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/unknown participant/i);
    expect((await getRoomState(splitId))!.items[0].sharedByAll).toBe(true);
  });
});
