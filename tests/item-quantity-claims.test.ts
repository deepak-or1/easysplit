import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fr } from "@/lib/fraction";

/**
 * Shrinking an item's quantity must not strand over-claims. The old cleanup
 * deleted only claims whose INDIVIDUAL share exceeded the new quantity, so
 * A(2) + B(1) on a qty-3 item both survived a shrink to 2 — the item read as
 * fully claimed while split-math silently clamped and re-priced everyone.
 */

const dbFile = path.join(os.tmpdir(), `settle-item-claims-${process.pid}-${Date.now()}.db`);
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

/** A room with one qty-`quantity` item, claimed by one guest per entry in `shares`. */
async function roomWithClaims(quantity: number, shares: number[]) {
  const { splitId } = await createSplit({
    hostName: "Host",
    tipType: "percent",
    tipValue: 20,
    taxCents: 0,
    items: [{ name: "Tacos", quantity, unitPriceCents: 500, totalCents: 500 * quantity }],
  });
  const before = await getRoomState(splitId);
  const itemId = before!.items[0].id;

  for (const [i, share] of shares.entries()) {
    const guest = await joinParticipant(splitId, `Guest${i}`);
    const result = await applyActions(splitId, [
      { type: "set", itemId, participantId: guest.id, share: fr(share) },
    ]);
    expect(result.rejected).toEqual([]);
  }
  return { splitId, itemId };
}

async function claimCount(splitId: string): Promise<number> {
  const state = await getRoomState(splitId);
  return state!.items[0].claims.length;
}

/** Resize the single item, leaving everything else about it alone. */
async function setQuantity(splitId: string, itemId: string, quantity: number) {
  await replaceItems(splitId, [
    {
      id: itemId,
      name: "Tacos",
      quantity,
      unitPriceCents: 500,
      totalCents: 500 * quantity,
      sharedByAll: false,
    },
  ]);
}

describe("replaceItems — claim cleanup on quantity shrink", () => {
  it("drops every claim when the claimed total no longer fits (2 + 1 on qty 3 → 2)", async () => {
    const { splitId, itemId } = await roomWithClaims(3, [2, 1]);
    expect(await claimCount(splitId)).toBe(2);

    await setQuantity(splitId, itemId, 2);
    expect(await claimCount(splitId)).toBe(0);
  });

  it("drops claims that individually fit but collectively over-claim (1 + 1 + 1 on qty 3 → 2)", async () => {
    const { splitId, itemId } = await roomWithClaims(3, [1, 1, 1]);
    await setQuantity(splitId, itemId, 2);
    expect(await claimCount(splitId)).toBe(0);
  });

  it("keeps claims when the quantity is unchanged (3 → 3)", async () => {
    const { splitId, itemId } = await roomWithClaims(3, [2, 1]);
    await setQuantity(splitId, itemId, 3);

    const state = await getRoomState(splitId);
    expect(state!.items[0].claims).toHaveLength(2);
    expect(state!.items[0].claimedShare).toEqual(fr(3));
    expect(state!.items[0].quantity).toBe(3);
  });

  it("keeps a claim that still fits (single claim of 1 on qty 3 → 2)", async () => {
    const { splitId, itemId } = await roomWithClaims(3, [1]);
    await setQuantity(splitId, itemId, 2);

    const state = await getRoomState(splitId);
    expect(state!.items[0].claims).toHaveLength(1);
    expect(state!.items[0].claims[0].share).toEqual(fr(1));
    expect(state!.items[0].remaining).toEqual(fr(1));
  });

  it("keeps fractional claims that still fit, and drops them once they don't", async () => {
    const { splitId, itemId } = await roomWithClaims(3, [1, 1]);
    await setQuantity(splitId, itemId, 2);
    expect(await claimCount(splitId)).toBe(2);

    await setQuantity(splitId, itemId, 1);
    expect(await claimCount(splitId)).toBe(0);
  });

  it("still drops a single claim larger than the new quantity (3 on qty 3 → 2)", async () => {
    const { splitId, itemId } = await roomWithClaims(3, [3]);
    await setQuantity(splitId, itemId, 2);
    expect(await claimCount(splitId)).toBe(0);
  });

  it("leaves a shrunk item claimable again, with the full new quantity free", async () => {
    const { splitId, itemId } = await roomWithClaims(3, [2, 1]);
    await setQuantity(splitId, itemId, 2);

    const state = await getRoomState(splitId);
    expect(state!.items[0].claimedShare).toEqual(fr(0));
    expect(state!.items[0].remaining).toEqual(fr(2));

    const guest = await joinParticipant(splitId, "Latecomer");
    const result = await applyActions(splitId, [
      { type: "set", itemId, participantId: guest.id, share: fr(2) },
    ]);
    expect(result.rejected).toEqual([]);
    expect(await claimCount(splitId)).toBe(1);
  });
});
