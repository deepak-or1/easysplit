import { F_ZERO, fcmp, fIsZero, formatFrac, fr, fsub, fsum, toNumber } from "./fraction";
import { allocate, allocateByInts } from "./money";
import type {
  Claim,
  DiscountType,
  Frac,
  Participant,
  PersonSettlement,
  ReceiptItem,
  Settlement,
  SettlementLine,
  TipType,
} from "./types";

export interface SettlementInput {
  items: ReceiptItem[];
  claims: Claim[];
  participants: Participant[];
  taxCents: number;
  tipType: TipType;
  tipValue: number; // percent (may be fractional) or cents
  /** null = no whole-bill discount. */
  discountType?: DiscountType | null;
  discountValue?: number; // percent (may be fractional) or cents
}

export function computeTipCents(subtotalCents: number, tipType: TipType, tipValue: number): number {
  if (tipType === "amount") return Math.max(0, Math.round(tipValue));
  return Math.max(0, Math.round((subtotalCents * tipValue) / 100));
}

/**
 * The whole-bill discount, in cents. Always clamped to [0, subtotalCents]: the
 * discount can never exceed what the items cost, so the bill can't go negative
 * even when a stored amount was entered against a bigger, since-edited receipt.
 * Note the tip is computed on the PRE-discount subtotal — you tip on the meal
 * you were served, not on the coupon.
 */
export function computeDiscountCents(
  subtotalCents: number,
  discountType: DiscountType | null,
  discountValue: number,
): number {
  if (discountType === null) return 0;
  const raw =
    discountType === "amount"
      ? Math.round(discountValue)
      : Math.round((subtotalCents * discountValue) / 100);
  return Math.min(Math.max(0, subtotalCents), Math.max(0, raw));
}

/**
 * The effective claims on an item. sharedByAll items are treated as an even
 * split across every participant (quantity/N each) and explicit claims are
 * ignored; with zero participants a shared item is simply unclaimed.
 */
export function effectiveClaims(
  item: ReceiptItem,
  claims: Claim[],
  participants: Participant[],
): Claim[] {
  if (item.sharedByAll) {
    if (participants.length === 0) return [];
    return participants.map((p) => ({
      itemId: item.id,
      participantId: p.id,
      share: fr(item.quantity, participants.length),
    }));
  }
  return claims.filter((c) => c.itemId === item.id && !fIsZero(c.share));
}

/** Σ shares claimed on an item (after sharedByAll expansion). */
export function claimedShare(item: ReceiptItem, claims: Claim[], participants: Participant[]): Frac {
  return fsum(effectiveClaims(item, claims, participants).map((c) => c.share));
}

/**
 * Compute the full settlement. Guarantees, by construction:
 *   Σ people.totalCents + unclaimed.totalCents === subtotal + tax + tip − discount
 * Every division uses largest-remainder allocation over exact rationals,
 * with the unclaimed bucket last so degenerate remainders land there. The
 * discount is allocated exactly like tax and tip — same buckets, same weights —
 * and subtracted, so it never strands a cent.
 */
export function computeSettlement(input: SettlementInput): Settlement {
  const { items, claims, participants, taxCents, tipType, tipValue } = input;
  const discountType = input.discountType ?? null;
  const discountValue = input.discountValue ?? 0;

  const subtotalCents = items.reduce((s, it) => s + it.totalCents, 0);
  const tipCents = computeTipCents(subtotalCents, tipType, tipValue);
  const discountCents = computeDiscountCents(subtotalCents, discountType, discountValue);
  const grandTotalCents = subtotalCents + taxCents + tipCents - discountCents;

  const byPerson = new Map<string, { lines: SettlementLine[]; itemsCents: number }>();
  for (const p of participants) byPerson.set(p.id, { lines: [], itemsCents: 0 });
  const unclaimedLines: SettlementLine[] = [];
  let unclaimedItemsCents = 0;

  let claimedWeight = 0; // for progress ratio, in item-cents terms

  for (const item of items) {
    const eff = effectiveClaims(item, claims, participants).filter((c) =>
      byPerson.has(c.participantId),
    );
    const claimed = fsum(eff.map((c) => c.share));
    let remaining = fsub(fr(item.quantity), claimed);
    if (remaining.n < 0) remaining = F_ZERO; // over-claimed: allocate proportionally, nothing unclaimed

    // Weights: one per claim, plus the unclaimed remainder LAST.
    const weights = [...eff.map((c) => c.share), remaining];
    const parts = allocate(item.totalCents, weights);

    eff.forEach((c, i) => {
      const cents = parts[i];
      if (cents === 0 && fIsZero(c.share)) return;
      const bucket = byPerson.get(c.participantId)!;
      bucket.itemsCents += cents;
      bucket.lines.push({
        itemId: item.id,
        label: labelFor(item, c.share),
        share: c.share,
        amountCents: cents,
      });
    });
    const unclaimedCents = parts[parts.length - 1];
    if (unclaimedCents > 0) {
      unclaimedItemsCents += unclaimedCents;
      unclaimedLines.push({
        itemId: item.id,
        label: labelFor(item, remaining),
        share: remaining,
        amountCents: unclaimedCents,
      });
    }
    claimedWeight += item.totalCents - unclaimedCents;
  }

  // Tax, tip & discount proportional to item subtotals; unclaimed bucket last.
  const order = participants.map((p) => p.id);
  const itemWeights = order.map((id) => byPerson.get(id)!.itemsCents);
  const taxParts = allocateByInts(taxCents, [...itemWeights, unclaimedItemsCents]);
  const tipParts = allocateByInts(tipCents, [...itemWeights, unclaimedItemsCents]);
  const discountParts = allocateByInts(discountCents, [...itemWeights, unclaimedItemsCents]);

  const people: PersonSettlement[] = order.map((id, i) => {
    const bucket = byPerson.get(id)!;
    return {
      participantId: id,
      lines: bucket.lines,
      itemsCents: bucket.itemsCents,
      taxCents: taxParts[i],
      tipCents: tipParts[i],
      discountCents: discountParts[i],
      isBirthday: participants[i].isBirthday,
      birthdayAdjustmentCents: 0,
      totalCents: bucket.itemsCents + taxParts[i] + tipParts[i] - discountParts[i],
    };
  });

  // Birthday people pay $0 — mutates `people` in place, before the sum below.
  applyBirthdayAdjustments(people);

  const unclaimed = {
    lines: unclaimedLines,
    itemsCents: unclaimedItemsCents,
    taxCents: taxParts[taxParts.length - 1],
    tipCents: tipParts[tipParts.length - 1],
    discountCents: discountParts[discountParts.length - 1],
    totalCents:
      unclaimedItemsCents +
      taxParts[taxParts.length - 1] +
      tipParts[tipParts.length - 1] -
      discountParts[discountParts.length - 1],
  };

  const sum = people.reduce((s, p) => s + p.totalCents, 0) + unclaimed.totalCents;

  return {
    people,
    unclaimed,
    subtotalCents,
    taxCents,
    tipCents,
    discountCents,
    grandTotalCents,
    reconciles: sum === grandTotalCents,
    claimedRatio: subtotalCents === 0 ? 1 : claimedWeight / subtotalCents,
  };
}

/**
 * Birthday redistribution, applied after the ordinary settlement. A birthday
 * person pays nothing: their whole share (items + tax + tip − discount) is
 * covered evenly by everyone else, allocated with largest-remainder over equal
 * weights so the cents distribute exactly. itemsCents/taxCents/tipCents/
 * discountCents are left alone — they stay informational, and the money moves
 * entirely through `birthdayAdjustmentCents`, which sums to zero across the room. So
 * Σ people.totalCents + unclaimed.totalCents is unchanged and `reconciles`
 * still holds.
 *
 * The unclaimed bucket is not a person: it never contributes and is never
 * adjusted. If EVERY participant is flagged there is nobody left to pay, so
 * the flags are ignored entirely and all adjustments stay 0.
 */
function applyBirthdayAdjustments(people: PersonSettlement[]): void {
  const celebrants = people.filter((p) => p.isBirthday);
  const contributors = people.filter((p) => !p.isBirthday);
  if (celebrants.length === 0 || contributors.length === 0) return;

  let coveredCents = 0;
  for (const p of celebrants) {
    const owed = p.itemsCents + p.taxCents + p.tipCents - p.discountCents;
    // `owed === 0 ? 0 : -owed` and not plain `-owed`: negating 0 yields -0,
    // which is === 0 but not Object.is-equal to it, and that difference leaks
    // into assertions and any Map/Set keyed on the value.
    p.birthdayAdjustmentCents = owed === 0 ? 0 : -owed;
    p.totalCents = 0;
    coveredCents += owed;
  }

  const shares = allocateByInts(
    coveredCents,
    contributors.map(() => 1),
  );
  contributors.forEach((p, i) => {
    p.birthdayAdjustmentCents = shares[i];
    p.totalCents = p.itemsCents + p.taxCents + p.tipCents - p.discountCents + shares[i];
  });
}

function labelFor(item: ReceiptItem, share: Frac): string {
  const whole = fcmp(share, fr(item.quantity)) === 0;
  if (whole) return item.name;
  if (item.quantity > 1 && share.d === 1) return `${item.name} ×${share.n}`;
  return `${item.name} (${formatFrac(share)})`;
}

/** Convenience used by pay pages / SMS replies: settlement entry for one person. */
export function settlementFor(settlement: Settlement, participantId: string): PersonSettlement | null {
  return settlement.people.find((p) => p.participantId === participantId) ?? null;
}

export { toNumber };
