import { describe, it, expect } from "vitest";
import { applyClaimActions } from "@/lib/claims";
import { fr } from "@/lib/fraction";
import type { Claim, ClaimAction, Participant, ReceiptItem } from "@/lib/types";

// ---- factories ----
function item(id: string, name: string, quantity: number, sharedByAll = false): ReceiptItem {
  return {
    id,
    name,
    quantity,
    unitPriceCents: 1000,
    totalCents: 1000 * quantity,
    sharedByAll,
    sortOrder: 0,
  };
}
function person(id: string, name = id): Participant {
  return { id, name, isHost: id === "A", paidStatus: "unpaid", joinedAt: "2026-01-01T00:00:00.000Z" };
}

const PEOPLE = [person("A"), person("B"), person("C")];
const ITEMS = [
  item("nachos", "Nachos", 1),
  item("fries", "Fries", 2),
  item("marg", "Margarita", 3),
  item("queso", "Queso", 1, true), // sharedByAll
];

const claimFor = (r: { claims: Claim[] }, itemId: string, pid: string) =>
  r.claims.find((c) => c.itemId === itemId && c.participantId === pid);

describe("applyClaimActions — set semantics", () => {
  it("upserts: a second set for the same participant+item replaces the first", () => {
    const actions: ClaimAction[] = [
      { type: "set", itemId: "nachos", participantId: "A", share: fr(1, 3) },
      { type: "set", itemId: "nachos", participantId: "A", share: fr(1, 2) },
    ];
    const r = applyClaimActions(ITEMS, [], actions, PEOPLE);
    const forA = r.claims.filter((c) => c.itemId === "nachos" && c.participantId === "A");
    expect(forA).toHaveLength(1);
    expect(forA[0].share).toEqual(fr(1, 2));
    expect(r.changedItemIds).toEqual(["nachos"]);
    expect(r.rejected).toEqual([]);
  });

  it("set with share 0 deletes an existing claim", () => {
    const current: Claim[] = [{ itemId: "nachos", participantId: "A", share: fr(1, 2) }];
    const r = applyClaimActions(
      ITEMS,
      current,
      [{ type: "set", itemId: "nachos", participantId: "A", share: fr(0) }],
      PEOPLE,
    );
    expect(claimFor(r, "nachos", "A")).toBeUndefined();
    expect(r.changedItemIds).toEqual(["nachos"]);
  });

  it("unclaim deletes an existing claim", () => {
    const current: Claim[] = [{ itemId: "nachos", participantId: "A", share: fr(1, 1) }];
    const r = applyClaimActions(
      ITEMS,
      current,
      [{ type: "unclaim", itemId: "nachos", participantId: "A" }],
      PEOPLE,
    );
    expect(claimFor(r, "nachos", "A")).toBeUndefined();
    expect(r.changedItemIds).toEqual(["nachos"]);
  });
});

describe("applyClaimActions — rejections", () => {
  it("rejects an over-claim, naming how much is left", () => {
    const current: Claim[] = [{ itemId: "nachos", participantId: "B", share: fr(1, 2) }];
    const r = applyClaimActions(
      ITEMS,
      current,
      [{ type: "set", itemId: "nachos", participantId: "A", share: fr(3, 4) }],
      PEOPLE,
    );
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toContain("Only ½ of");
    expect(r.rejected[0].reason).toContain("Nachos");
    expect(claimFor(r, "nachos", "A")).toBeUndefined();
    expect(r.changedItemIds).toEqual([]);
  });

  it("rejects a claim on a fully-claimed item with 'already fully claimed'", () => {
    const current: Claim[] = [{ itemId: "nachos", participantId: "B", share: fr(1, 1) }];
    const r = applyClaimActions(
      ITEMS,
      current,
      [{ type: "set", itemId: "nachos", participantId: "A", share: fr(1, 2) }],
      PEOPLE,
    );
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toContain("already fully claimed");
  });

  it("rejects an individual claim on a sharedByAll item", () => {
    const r = applyClaimActions(
      ITEMS,
      [],
      [{ type: "set", itemId: "queso", participantId: "A", share: fr(1, 1) }],
      PEOPLE,
    );
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toContain("shared by the whole table");
    expect(r.claims).toEqual([]);
  });

  it("rejects an unknown item", () => {
    const r = applyClaimActions(
      ITEMS,
      [],
      [{ type: "set", itemId: "ghost", participantId: "A", share: fr(1, 1) }],
      PEOPLE,
    );
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toContain("isn't on the receipt");
    expect(r.changedItemIds).toEqual([]);
  });

  it("rejects an unknown participant", () => {
    const r = applyClaimActions(
      ITEMS,
      [],
      [{ type: "set", itemId: "nachos", participantId: "ZZ", share: fr(1, 1) }],
      PEOPLE,
    );
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toContain("Unknown participant");
  });
});

describe("applyClaimActions — split", () => {
  it("split of a fresh item gives fr(quantity, N) each", () => {
    // Margarita qty 3, split between A and B => fr(3,2) each.
    const r = applyClaimActions(
      ITEMS,
      [],
      [{ type: "split", itemId: "marg", participantIds: ["A", "B"] }],
      PEOPLE,
    );
    expect(claimFor(r, "marg", "A")!.share).toEqual(fr(3, 2));
    expect(claimFor(r, "marg", "B")!.share).toEqual(fr(3, 2));
    expect(r.changedItemIds).toEqual(["marg"]);
  });

  it("split when others already claimed part splits only the remainder", () => {
    // Fries qty 2, C already holds 1/2. Split remainder (3/2) between A and B => fr(3,4) each.
    const current: Claim[] = [{ itemId: "fries", participantId: "C", share: fr(1, 2) }];
    const r = applyClaimActions(
      ITEMS,
      current,
      [{ type: "split", itemId: "fries", participantIds: ["A", "B"] }],
      PEOPLE,
    );
    expect(claimFor(r, "fries", "A")!.share).toEqual(fr(3, 4));
    expect(claimFor(r, "fries", "B")!.share).toEqual(fr(3, 4));
    // C's prior claim is untouched
    expect(claimFor(r, "fries", "C")!.share).toEqual(fr(1, 2));
  });

  it("rejects a split of an already fully-claimed item", () => {
    const current: Claim[] = [{ itemId: "nachos", participantId: "C", share: fr(1, 1) }];
    const r = applyClaimActions(
      ITEMS,
      current,
      [{ type: "split", itemId: "nachos", participantIds: ["A", "B"] }],
      PEOPLE,
    );
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toContain("already fully claimed");
  });
});

describe("applyClaimActions — changedItemIds", () => {
  it("lists only the items actually touched", () => {
    const r = applyClaimActions(
      ITEMS,
      [],
      [{ type: "set", itemId: "nachos", participantId: "A", share: fr(1, 2) }],
      PEOPLE,
    );
    expect(r.changedItemIds).toEqual(["nachos"]);
  });

  it("does not mark a no-op unclaim of a non-existent claim", () => {
    const r = applyClaimActions(
      ITEMS,
      [],
      [{ type: "unclaim", itemId: "nachos", participantId: "A" }],
      PEOPLE,
    );
    expect(r.changedItemIds).toEqual([]);
    expect(r.rejected).toEqual([]);
  });
});
