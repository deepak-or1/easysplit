"use client";

import { Money } from "@/components/ui";

/**
 * The one unambiguous money block: Items + Tax (+ Tip) with the grand total
 * big and unmissable. Used on both the check and host steps so the host
 * always knows exactly what the table owes.
 */
export function TotalsSummary({
  itemsCents,
  taxCents,
  tipCents,
  tipLabel = "Tip / service",
}: {
  itemsCents: number;
  taxCents: number;
  tipCents: number | null; // null = tip not chosen yet ("total before tip")
  tipLabel?: string;
}) {
  const total = itemsCents + taxCents + (tipCents ?? 0);
  return (
    <div className="flex flex-col gap-1.5">
      <Row label="Items" cents={itemsCents} />
      <Row label="Tax" cents={taxCents} />
      {tipCents != null && <Row label={tipLabel} cents={tipCents} />}
      <hr className="receipt-rule my-1.5" />
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">
          {tipCents == null ? "Total before tip" : "Table total"}
        </span>
        <Money cents={total} className="font-display text-3xl font-semibold text-ink" />
      </div>
    </div>
  );
}

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <Money cents={cents} className="text-ink" />
    </div>
  );
}
