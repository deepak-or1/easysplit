import { allocateByInts } from "./money";

/**
 * Itemizing quantities: a receipt line like "Vodka Pasta ×4 $80.00" becomes
 * four separate "Vodka Pasta" lines at $20.00 each, so guests can split each
 * plate on its own. One line with a single set of claims can't express "two of
 * us shared one, two people got their own, four of us shared the last" — the
 * quantity-fraction UI tops out at halves and thirds of the WHOLE line — but
 * four lines of quantity 1 express it with the ordinary split picker.
 *
 * The rows' totals are allocated by largest remainder so they sum EXACTLY to
 * the printed line total: "3 Tacos $10.00" itemizes to 334 + 333 + 333, never
 * 3 × 333 = 999. Every row is quantity 1, so its unit price is its total.
 */

/** The max length the API accepts for an item name (see itemSchema). */
const MAX_NAME = 80;

export interface ItemizableLine {
  name: string;
  quantity: number;
  totalCents: number;
}

export interface ItemizedRow {
  name: string;
  quantity: 1;
  unitPriceCents: number;
  totalCents: number;
}

/** Whether a line has anything to itemize — a ×1 line is already a single. */
export function isItemizable(line: { quantity: number }): boolean {
  return Math.round(line.quantity) > 1;
}

/**
 * Split a line's total into `quantity` per-unit totals that sum exactly to it.
 * Remainder cents go to the earliest rows (largest-remainder allocation, ties
 * broken by index). A quantity of 1 or less returns the total untouched.
 */
export function itemizeCents(totalCents: number, quantity: number): number[] {
  const qty = Math.max(1, Math.round(quantity) || 1);
  if (qty === 1) return [totalCents];
  return allocateByInts(totalCents, new Array<number>(qty).fill(1));
}

/**
 * The name each itemized row carries. Rows are numbered so the guest list
 * still reads as one order ("Vodka Pasta (2 of 4)") rather than four
 * indistinguishable lines, and the suffix wins over a long name: the base is
 * trimmed so the whole thing stays within the API's name limit.
 */
export function itemizedName(name: string, index: number, quantity: number): string {
  const suffix = ` (${index + 1} of ${quantity})`;
  const base = name.trim();
  const room = MAX_NAME - suffix.length;
  const head = base.length > room ? base.slice(0, Math.max(0, room - 1)).trimEnd() + "…" : base;
  return head + suffix;
}

/**
 * Expand one line into `quantity` single-unit rows. A ×1 line comes back as a
 * single row with its name unchanged, so callers can map every line through
 * this without special-casing.
 */
export function itemizeLine(line: ItemizableLine): ItemizedRow[] {
  const qty = Math.max(1, Math.round(line.quantity) || 1);
  const cents = itemizeCents(line.totalCents, qty);
  if (qty === 1) {
    return [{ name: line.name, quantity: 1, unitPriceCents: cents[0], totalCents: cents[0] }];
  }
  return cents.map((c, i) => ({
    name: itemizedName(line.name, i, qty),
    quantity: 1,
    unitPriceCents: c,
    totalCents: c,
  }));
}
