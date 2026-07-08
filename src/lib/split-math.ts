import { F_ZERO, fcmp, fIsZero, formatFrac, fr, fsub, fsum, toNumber } from "./fraction";
import { allocate, allocateByInts } from "./money";
import type {
  Claim,
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
}

export function computeTipCents(subtotalCents: number, tipType: TipType, tipValue: number): number {
  if (tipType === "amount") return Math.max(0, Math.round(tipValue));
  return Math.max(0, Math.round((subtotalCents * tipValue) / 100));
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

/** quantity − claimed, clamped at zero. */
export function remainingShare(item: ReceiptItem, claims: Claim[], participants: Participant[]): Frac {
  const rem = fsub(fr(item.quantity), claimedShare(item, claims, participants));
  return rem.n < 0 ? F_ZERO : rem;
}

/**
 * Compute the full settlement. Guarantees, by construction:
 *   Σ people.totalCents + unclaimed.totalCents === subtotal + tax + tip
 * Every division uses largest-remainder allocation over exact rationals,
 * with the unclaimed bucket last so degenerate remainders land there.
 */
export function computeSettlement(input: SettlementInput): Settlement {
  const { items, claims, participants, taxCents, tipType, tipValue } = input;

  const subtotalCents = items.reduce((s, it) => s + it.totalCents, 0);
  const tipCents = computeTipCents(subtotalCents, tipType, tipValue);
  const grandTotalCents = subtotalCents + taxCents + tipCents;

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

  // Tax & tip proportional to item subtotals; unclaimed bucket last.
  const order = participants.map((p) => p.id);
  const itemWeights = order.map((id) => byPerson.get(id)!.itemsCents);
  const taxParts = allocateByInts(taxCents, [...itemWeights, unclaimedItemsCents]);
  const tipParts = allocateByInts(tipCents, [...itemWeights, unclaimedItemsCents]);

  const people: PersonSettlement[] = order.map((id, i) => {
    const bucket = byPerson.get(id)!;
    return {
      participantId: id,
      lines: bucket.lines,
      itemsCents: bucket.itemsCents,
      taxCents: taxParts[i],
      tipCents: tipParts[i],
      totalCents: bucket.itemsCents + taxParts[i] + tipParts[i],
    };
  });

  const unclaimed = {
    lines: unclaimedLines,
    itemsCents: unclaimedItemsCents,
    taxCents: taxParts[taxParts.length - 1],
    tipCents: tipParts[tipParts.length - 1],
    totalCents:
      unclaimedItemsCents + taxParts[taxParts.length - 1] + tipParts[tipParts.length - 1],
  };

  const sum = people.reduce((s, p) => s + p.totalCents, 0) + unclaimed.totalCents;

  return {
    people,
    unclaimed,
    subtotalCents,
    taxCents,
    tipCents,
    grandTotalCents,
    reconciles: sum === grandTotalCents,
    claimedRatio: subtotalCents === 0 ? 1 : claimedWeight / subtotalCents,
  };
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
