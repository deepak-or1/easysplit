import { F_ZERO, fcmp } from "@/lib/fraction";
import type { ClaimAction, ItemWithClaims } from "@/lib/types";

/**
 * Pure list logic for the guest receipt — search, grouping and multi-select.
 * Kept out of the components so the behaviour that matters on a 60-line
 * grocery receipt (what's still open, what's already mine, what one tap will
 * actually POST) is testable with plain data.
 */

/** Above this many items the receipt gets search, groups and multi-select. */
export const LONG_RECEIPT_THRESHOLD = 10;

/** Strictly MORE than the threshold — an even ten still reads fine as a list. */
export function isLongReceipt(items: readonly ItemWithClaims[]): boolean {
  return items.length > LONG_RECEIPT_THRESHOLD;
}

/** Case-insensitive substring match on the item name. Blank query = everything. */
export function filterItems<T extends { name: string }>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((it) => it.name.toLowerCase().includes(q));
}

export type ItemGroup = "unclaimed" | "yours" | "claimed";

/**
 * Which bucket an item belongs in, from one person's point of view.
 *
 * `sharedByAll` counts as "yours": the settlement already charges you a slice
 * of it, and on a grocery run — where every item starts shared — burying them
 * in the collapsed "claimed" pile would hide the whole receipt (and the
 * takeover action with it).
 */
export function groupOf(item: ItemWithClaims, participantId: string): ItemGroup {
  if (item.sharedByAll) return "yours";
  if (item.claims.some((c) => c.participantId === participantId)) return "yours";
  return fcmp(item.remaining, F_ZERO) > 0 ? "unclaimed" : "claimed";
}

export interface GroupedItems {
  unclaimed: ItemWithClaims[];
  yours: ItemWithClaims[];
  /** Fully claimed by other people — nothing left for you to take. */
  claimed: ItemWithClaims[];
}

/** Partition into the three buckets, preserving receipt order within each. */
export function groupItems(
  items: readonly ItemWithClaims[],
  participantId: string,
): GroupedItems {
  const grouped: GroupedItems = { unclaimed: [], yours: [], claimed: [] };
  for (const item of items) grouped[groupOf(item, participantId)].push(item);
  return grouped;
}

/** Only items with something left on them can be multi-selected. */
export function isSelectable(item: ItemWithClaims, participantId: string): boolean {
  return groupOf(item, participantId) === "unclaimed";
}

/** Add/remove one id — the accumulating "these are mine" pile. */
export function toggleSelected(selected: ReadonlySet<string>, itemId: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (!next.delete(itemId)) next.add(itemId);
  return next;
}

/**
 * Drop ids that someone else claimed (or that vanished) while the pile sat
 * open. Returns the SAME set when nothing changed, so a polling refresh can
 * call this every render without churning state.
 */
export function pruneSelection(
  selected: ReadonlySet<string>,
  items: readonly ItemWithClaims[],
  participantId: string,
): ReadonlySet<string> {
  const live = new Set(
    items.filter((it) => isSelectable(it, participantId)).map((it) => it.id),
  );
  let stale = false;
  for (const id of selected) {
    if (!live.has(id)) {
      stale = true;
      break;
    }
  }
  if (!stale) return selected;
  return new Set([...selected].filter((id) => live.has(id)));
}

/**
 * The one POST body behind "These N are mine": a `set` per still-claimable
 * selected item, each taking that item's full remaining share. Receipt order,
 * so the resulting chat/feed reads top-to-bottom like the receipt does.
 */
export function buildSelectionActions(
  items: readonly ItemWithClaims[],
  selected: ReadonlySet<string>,
  participantId: string,
): ClaimAction[] {
  return items
    .filter((it) => selected.has(it.id) && isSelectable(it, participantId))
    .map((it) => ({
      type: "set" as const,
      itemId: it.id,
      participantId,
      share: it.remaining,
    }));
}
