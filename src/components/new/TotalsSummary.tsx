"use client";

import { Money } from "@/components/ui";

/**
 * The one unambiguous money block: Items + Tax (+ Tip) (− Discount) with the
 * grand total big and unmissable. Used on both the check and host steps so the
 * host always knows exactly what the table owes.
 */
export function TotalsSummary({
  itemsCents,
  taxCents,
  tipCents,
  discountCents,
  tipLabel = "Tip / service",
  totalLabel,
  totalEmoji,
}: {
  itemsCents: number;
  taxCents: number;
  tipCents: number | null; // null = no tip row (not chosen yet, or none exists)
  /** A whole-bill discount. No row at all unless it's positive — the feature is
   * invisible until it's used. */
  discountCents?: number | null;
  tipLabel?: string;
  /** Overrides the default label — a grocery run has no tip to be "before". */
  totalLabel?: string;
  /** Decorative marker in front of the total label (🛒 on a grocery run). */
  totalEmoji?: string;
}) {
  const discount = discountCents && discountCents > 0 ? discountCents : 0;
  const total = itemsCents + taxCents + (tipCents ?? 0) - discount;
  return (
    <div className="flex flex-col gap-1.5">
      <Row label="Items" cents={itemsCents} />
      <Row label="Tax" cents={taxCents} />
      {tipCents != null && <Row label={tipLabel} cents={tipCents} />}
      {discount > 0 && <Row label="Discount" cents={discount} negative />}
      <hr className="receipt-rule my-1.5" />
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">
          {totalEmoji && (
            <span aria-hidden className="mr-1">
              {totalEmoji}
            </span>
          )}
          {totalLabel ?? (tipCents == null ? "Total before tip" : "Table total")}
        </span>
        <Money cents={total} className="font-display text-3xl font-semibold text-ink" />
      </div>
    </div>
  );
}

function Row({ label, cents, negative }: { label: string; cents: number; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      {/* A discount reads as money coming OFF the bill, so it's rendered with a
          leading minus sign (U+2212 — it aligns with Money's tabular figures)
          rather than as a negative amount. */}
      <span className="text-ink tabular">
        {negative && "−"}
        <Money cents={cents} className="text-ink" />
      </span>
    </div>
  );
}
