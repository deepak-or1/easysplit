import { describe, expect, it } from "vitest";
import {
  LONG_RECEIPT_THRESHOLD,
  buildSelectionActions,
  filterItems,
  groupItems,
  groupOf,
  isLongReceipt,
  isSelectable,
  pruneSelection,
  toggleSelected,
} from "@/components/guest/list-helpers";
import { F_ONE, F_ZERO, fr } from "@/lib/fraction";
import type { Claim, ItemWithClaims } from "@/lib/types";

/**
 * A 60-line grocery receipt is a different product from a 6-line dinner one:
 * you search it, you scan it in groups, and you claim a fistful of items at
 * once. All of that is decided here, on plain data — the components only draw
 * what these functions return.
 */

const ME = "me";
const OTHER = "alex";

let seq = 0;

function item(over: Partial<ItemWithClaims> & { name: string }): ItemWithClaims {
  const claims: Claim[] = over.claims ?? [];
  const quantity = over.quantity ?? 1;
  const claimed = over.claimedShare ?? (claims.length > 0 ? claims[0].share : F_ZERO);
  return {
    id: over.id ?? `i${++seq}`,
    name: over.name,
    quantity,
    unitPriceCents: over.unitPriceCents ?? 500,
    totalCents: over.totalCents ?? 500 * quantity,
    sharedByAll: over.sharedByAll ?? false,
    sortOrder: over.sortOrder ?? seq,
    claims,
    claimedShare: claimed,
    remaining: over.remaining ?? (claims.length > 0 ? F_ZERO : fr(quantity)),
  };
}

const claim = (participantId: string, share = F_ONE): Claim => ({
  itemId: "unused",
  participantId,
  share,
});

/** n plain unclaimed items, named Item 1…n. */
function receipt(n: number): ItemWithClaims[] {
  return Array.from({ length: n }, (_, i) => item({ id: `i${i}`, name: `Item ${i + 1}` }));
}

describe("isLongReceipt — the >10 threshold", () => {
  it("is ten", () => {
    expect(LONG_RECEIPT_THRESHOLD).toBe(10);
  });

  it("leaves an empty receipt short", () => {
    expect(isLongReceipt([])).toBe(false);
  });

  it("leaves exactly ten items short — an even ten still reads as a list", () => {
    expect(isLongReceipt(receipt(10))).toBe(false);
  });

  it("turns on at eleven", () => {
    expect(isLongReceipt(receipt(11))).toBe(true);
  });
});

describe("filterItems", () => {
  const items = [
    item({ name: "Oat Milk" }),
    item({ name: "Whole Milk" }),
    item({ name: "Sourdough" }),
  ];

  it("matches a case-insensitive substring anywhere in the name", () => {
    expect(filterItems(items, "milk").map((i) => i.name)).toEqual(["Oat Milk", "Whole Milk"]);
    expect(filterItems(items, "MILK").map((i) => i.name)).toEqual(["Oat Milk", "Whole Milk"]);
    expect(filterItems(items, "ough").map((i) => i.name)).toEqual(["Sourdough"]);
  });

  it("returns everything for a blank or whitespace query", () => {
    expect(filterItems(items, "")).toHaveLength(3);
    expect(filterItems(items, "   ")).toHaveLength(3);
  });

  it("ignores surrounding whitespace in a real query", () => {
    expect(filterItems(items, "  oat ").map((i) => i.name)).toEqual(["Oat Milk"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterItems(items, "caviar")).toEqual([]);
  });

  it("preserves receipt order", () => {
    expect(filterItems(items, "o").map((i) => i.name)).toEqual([
      "Oat Milk",
      "Whole Milk",
      "Sourdough",
    ]);
  });
});

describe("groupOf / groupItems", () => {
  it("calls an untouched item unclaimed", () => {
    expect(groupOf(item({ name: "Eggs" }), ME)).toBe("unclaimed");
  });

  it("calls an item I claimed mine", () => {
    expect(groupOf(item({ name: "Eggs", claims: [claim(ME)] }), ME)).toBe("yours");
  });

  it("calls a fully-claimed item of someone else's claimed", () => {
    expect(groupOf(item({ name: "Eggs", claims: [claim(OTHER)] }), ME)).toBe("claimed");
  });

  it("keeps a partly-claimed item unclaimed — there's still some left", () => {
    const half = item({
      name: "Nachos",
      claims: [claim(OTHER, fr(1, 2))],
      claimedShare: fr(1, 2),
      remaining: fr(1, 2),
    });
    expect(groupOf(half, ME)).toBe("unclaimed");
  });

  it("counts a shared-by-all item as yours — you are already paying for it", () => {
    const shared = item({ name: "Coffee", sharedByAll: true, remaining: F_ZERO });
    expect(groupOf(shared, ME)).toBe("yours");
    // …even when the room's claims name other people only.
    const sharedWithClaims = item({
      name: "Coffee",
      sharedByAll: true,
      claims: [claim(OTHER)],
      remaining: F_ZERO,
    });
    expect(groupOf(sharedWithClaims, ME)).toBe("yours");
  });

  it("partitions a receipt into the three buckets, in receipt order", () => {
    const items = [
      item({ id: "a", name: "Apples" }),
      item({ id: "b", name: "Bagels", claims: [claim(ME)] }),
      item({ id: "c", name: "Cheese", claims: [claim(OTHER)] }),
      item({ id: "d", name: "Dates" }),
      item({ id: "e", name: "Eggs", sharedByAll: true, remaining: F_ZERO }),
    ];
    const groups = groupItems(items, ME);
    expect(groups.unclaimed.map((i) => i.id)).toEqual(["a", "d"]);
    expect(groups.yours.map((i) => i.id)).toEqual(["b", "e"]);
    expect(groups.claimed.map((i) => i.id)).toEqual(["c"]);
  });

  it("groups an empty receipt into three empty buckets", () => {
    expect(groupItems([], ME)).toEqual({ unclaimed: [], yours: [], claimed: [] });
  });

  it("only offers unclaimed items for multi-select", () => {
    expect(isSelectable(item({ name: "Apples" }), ME)).toBe(true);
    expect(isSelectable(item({ name: "Bagels", claims: [claim(ME)] }), ME)).toBe(false);
    expect(isSelectable(item({ name: "Cheese", claims: [claim(OTHER)] }), ME)).toBe(false);
    expect(isSelectable(item({ name: "Eggs", sharedByAll: true, remaining: F_ZERO }), ME)).toBe(
      false,
    );
  });
});

describe("toggleSelected — accumulating a pile", () => {
  it("adds ids one tap at a time", () => {
    let sel: ReadonlySet<string> = new Set<string>();
    sel = toggleSelected(sel, "a");
    sel = toggleSelected(sel, "b");
    sel = toggleSelected(sel, "c");
    expect([...sel]).toEqual(["a", "b", "c"]);
  });

  it("removes an id that's tapped again", () => {
    const sel = toggleSelected(toggleSelected(new Set(["a"]), "b"), "a");
    expect([...sel]).toEqual(["b"]);
  });

  it("never mutates the set it was given", () => {
    const before = new Set(["a"]);
    const after = toggleSelected(before, "b");
    expect([...before]).toEqual(["a"]);
    expect(after).not.toBe(before);
  });
});

describe("pruneSelection — someone else got there first", () => {
  const items = [
    item({ id: "a", name: "Apples" }),
    item({ id: "b", name: "Bagels" }),
    item({ id: "c", name: "Cheese", claims: [claim(OTHER)] }),
  ];

  it("returns the very same set when every pick is still claimable", () => {
    const sel = new Set(["a", "b"]);
    expect(pruneSelection(sel, items, ME)).toBe(sel);
  });

  it("drops a pick that someone else claimed while it sat selected", () => {
    expect([...pruneSelection(new Set(["a", "c"]), items, ME)]).toEqual(["a"]);
  });

  it("drops ids that aren't on the receipt at all any more", () => {
    expect([...pruneSelection(new Set(["a", "gone"]), items, ME)]).toEqual(["a"]);
  });

  it("empties out when nothing survives", () => {
    expect([...pruneSelection(new Set(["c"]), items, ME)]).toEqual([]);
  });

  it("leaves an empty selection alone", () => {
    const sel: ReadonlySet<string> = new Set<string>();
    expect(pruneSelection(sel, items, ME)).toBe(sel);
  });
});

describe("buildSelectionActions — one POST for the whole pile", () => {
  const items = [
    item({ id: "a", name: "Apples" }),
    item({ id: "b", name: "Bagels", quantity: 3, remaining: fr(3) }),
    item({
      id: "c",
      name: "Cheese",
      claims: [claim(OTHER, fr(1, 2))],
      claimedShare: fr(1, 2),
      remaining: fr(1, 2),
    }),
    item({ id: "d", name: "Dates", claims: [claim(OTHER)] }),
  ];

  it("emits one set action per pick, each taking the full remaining share", () => {
    const actions = buildSelectionActions(items, new Set(["a", "b", "c"]), ME);
    expect(actions).toEqual([
      { type: "set", itemId: "a", participantId: ME, share: F_ONE },
      { type: "set", itemId: "b", participantId: ME, share: fr(3) },
      { type: "set", itemId: "c", participantId: ME, share: fr(1, 2) },
    ]);
  });

  it("keeps receipt order regardless of the order things were picked in", () => {
    const actions = buildSelectionActions(items, new Set(["b", "a"]), ME);
    expect(actions.map((a) => a.itemId)).toEqual(["a", "b"]);
  });

  it("silently skips picks that are no longer claimable", () => {
    const actions = buildSelectionActions(items, new Set(["a", "d", "ghost"]), ME);
    expect(actions.map((a) => a.itemId)).toEqual(["a"]);
  });

  it("sends nothing for an empty pile", () => {
    expect(buildSelectionActions(items, new Set<string>(), ME)).toEqual([]);
  });
});
