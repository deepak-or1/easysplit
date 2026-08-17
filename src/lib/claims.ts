import { fcmp, fIsZero, formatFrac, fr, fsub, fsum } from "./fraction";
import type { Claim, ClaimAction, Participant, ReceiptItem, SplitType } from "./types";

export interface ApplyResult {
  /** Full next claim set (replaces the old one for the touched items). */
  claims: Claim[];
  /** Items whose claims changed. */
  changedItemIds: string[];
  /** Items taken over: their sharedByAll flag must be cleared by the writer. */
  unsharedItemIds: string[];
  /** Actions rejected with a human-readable reason (e.g. over-claiming). */
  rejected: { action: ClaimAction; reason: string }[];
}

/**
 * Pure claim-application: takes the current claim set and a list of actions,
 * returns the next claim set. Enforces:
 *  - a participant has at most one claim per item (set semantics)
 *  - total claims on an item never exceed its quantity (over-claims rejected
 *    with a reason naming how much is left)
 *  - sharedByAll items can't be claimed individually — except by `takeover`,
 *    which is grocery-only (hence `splitType`) and unshares the item
 * DB write layer diffs `claims` for changedItemIds and persists, and clears
 * sharedByAll for unsharedItemIds.
 */
export function applyClaimActions(
  items: ReceiptItem[],
  current: Claim[],
  actions: ClaimAction[],
  participants: Participant[],
  splitType: SplitType = "restaurant",
): ApplyResult {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const participantIds = new Set(participants.map((p) => p.id));
  const key = (itemId: string, pid: string) => `${itemId}::${pid}`;

  const next = new Map<string, Claim>(current.map((c) => [key(c.itemId, c.participantId), c]));
  const changed = new Set<string>();
  const unshared = new Set<string>();
  const rejected: ApplyResult["rejected"] = [];

  const totalOn = (itemId: string, excludePids: Set<string>) =>
    fsum(
      [...next.values()]
        .filter((c) => c.itemId === itemId && !excludePids.has(c.participantId))
        .map((c) => c.share),
    );

  for (const action of actions) {
    const item = itemById.get(action.itemId);
    if (!item) {
      rejected.push({ action, reason: "That item isn't on the receipt." });
      continue;
    }
    if (item.sharedByAll && action.type !== "unclaim" && action.type !== "takeover") {
      rejected.push({
        action,
        reason: `${item.name} is shared by the whole table — it's already split evenly.`,
      });
      continue;
    }

    // takeover: one person buys the whole shared item. Grocery rooms only —
    // "this bag of coffee is just mine" — and only from the shared state, so
    // it can never quietly overwrite someone else's explicit claims.
    if (action.type === "takeover") {
      if (splitType !== "grocery") {
        rejected.push({ action, reason: "Taking an item for yourself only works in grocery splits." });
        continue;
      }
      if (!item.sharedByAll) {
        rejected.push({
          action,
          reason: `${item.name} isn't shared by everyone — claim it the usual way.`,
        });
        continue;
      }
      if (!participantIds.has(action.participantId)) {
        rejected.push({ action, reason: "Unknown participant." });
        continue;
      }
      for (const [k, c] of [...next]) if (c.itemId === action.itemId) next.delete(k);
      next.set(key(action.itemId, action.participantId), {
        itemId: action.itemId,
        participantId: action.participantId,
        share: fr(item.quantity),
      });
      changed.add(action.itemId);
      unshared.add(action.itemId);
      // The writer clears sharedByAll in the DB, but later actions in THIS
      // batch read the in-memory snapshot — so unshare it here too. Without
      // this a following set/split on the same item is rejected as "shared by
      // the whole table", and a second takeover silently overwrites the first
      // instead of being caught by the not-shared check above.
      item.sharedByAll = false;
      continue;
    }

    if (action.type === "unclaim") {
      const k = key(action.itemId, action.participantId);
      if (next.delete(k)) changed.add(action.itemId);
      continue;
    }

    if (action.type === "set") {
      if (!participantIds.has(action.participantId)) {
        rejected.push({ action, reason: "Unknown participant." });
        continue;
      }
      if (action.share.n < 0) {
        rejected.push({ action, reason: "Share can't be negative." });
        continue;
      }
      if (fIsZero(action.share)) {
        const k = key(action.itemId, action.participantId);
        if (next.delete(k)) changed.add(action.itemId);
        continue;
      }
      const others = totalOn(action.itemId, new Set([action.participantId]));
      const wouldBe = fsum([others, action.share]);
      if (fcmp(wouldBe, fr(item.quantity)) > 0) {
        const left = fsub(fr(item.quantity), others);
        rejected.push({
          action,
          reason:
            left.n <= 0
              ? `${item.name} is already fully claimed.`
              : `Only ${formatFrac(left)} of ${item.name} is left unclaimed.`,
        });
        continue;
      }
      next.set(key(action.itemId, action.participantId), {
        itemId: action.itemId,
        participantId: action.participantId,
        share: action.share,
      });
      changed.add(action.itemId);
      continue;
    }

    // split: even split of the WHOLE item among the named participants,
    // replacing their previous claims on it; others' claims must still fit.
    if (action.type === "split") {
      const pids = [...new Set(action.participantIds)].filter((p) => participantIds.has(p));
      if (pids.length === 0) {
        rejected.push({ action, reason: "No known people to split with." });
        continue;
      }
      const others = totalOn(action.itemId, new Set(pids));
      if (!fIsZero(others)) {
        // Split what's left among the group instead of the whole item.
        const left = fsub(fr(item.quantity), others);
        if (left.n <= 0) {
          rejected.push({ action, reason: `${item.name} is already fully claimed.` });
          continue;
        }
        for (const pid of pids) {
          next.set(key(action.itemId, pid), {
            itemId: action.itemId,
            participantId: pid,
            share: fr(left.n, left.d * pids.length),
          });
        }
      } else {
        for (const pid of pids) {
          next.set(key(action.itemId, pid), {
            itemId: action.itemId,
            participantId: pid,
            share: fr(item.quantity, pids.length),
          });
        }
      }
      changed.add(action.itemId);
    }
  }

  return {
    claims: [...next.values()],
    changedItemIds: [...changed],
    unsharedItemIds: [...unshared],
    rejected,
  };
}
