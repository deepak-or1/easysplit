import { fcmp, fIsZero, formatFrac, fr, fsub, fsum } from "./fraction";
import type { Claim, ClaimAction, Participant, ReceiptItem } from "./types";

export interface ApplyResult {
  /** Full next claim set (replaces the old one for the touched items). */
  claims: Claim[];
  /** Items whose claims changed. */
  changedItemIds: string[];
  /** Actions rejected with a human-readable reason (e.g. over-claiming). */
  rejected: { action: ClaimAction; reason: string }[];
}

/**
 * Pure claim-application: takes the current claim set and a list of actions,
 * returns the next claim set. Enforces:
 *  - a participant has at most one claim per item (set semantics)
 *  - total claims on an item never exceed its quantity (over-claims rejected
 *    with a reason naming how much is left)
 *  - sharedByAll items can't be claimed individually
 * DB write layer diffs `claims` for changedItemIds and persists.
 */
export function applyClaimActions(
  items: ReceiptItem[],
  current: Claim[],
  actions: ClaimAction[],
  participants: Participant[],
): ApplyResult {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const participantIds = new Set(participants.map((p) => p.id));
  const key = (itemId: string, pid: string) => `${itemId}::${pid}`;

  const next = new Map<string, Claim>(current.map((c) => [key(c.itemId, c.participantId), c]));
  const changed = new Set<string>();
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
    if (item.sharedByAll && action.type !== "unclaim") {
      rejected.push({
        action,
        reason: `${item.name} is shared by the whole table — it's already split evenly.`,
      });
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

  return { claims: [...next.values()], changedItemIds: [...changed], rejected };
}
