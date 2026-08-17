"use client";

import type { ItemWithClaims, UnclaimedSettlement } from "@/lib/types";
import { Badge, Card, Money } from "@/components/ui";

export function UnclaimedPanel({
  unclaimed,
  items,
}: {
  unclaimed: UnclaimedSettlement;
  items: ItemWithClaims[];
}) {
  const nameById = new Map(items.map((it) => [it.id, it.name]));

  return (
    <Card className="animate-[var(--animate-rise)] space-y-3 border-gold/50 bg-gold-soft p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-[#6f5a00]">Still unclaimed</h2>
        <Badge tone="gold">
          <Money cents={unclaimed.totalCents} />
        </Badge>
      </div>

      {unclaimed.lines.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {unclaimed.lines.map((line) => (
            <li key={line.itemId} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-ink">
                {line.label || nameById.get(line.itemId) || "Item"}
              </span>
              <Money cents={line.amountCents} className="shrink-0 text-ink" />
            </li>
          ))}
        </ul>
      )}

      {(unclaimed.taxCents > 0 || unclaimed.tipCents > 0 || unclaimed.discountCents > 0) && (
        <div className="space-y-1 border-t border-gold/40 pt-2 text-sm text-[#6f5a00]">
          {unclaimed.taxCents > 0 && (
            <div className="flex justify-between">
              <span>Tax share</span>
              <Money cents={unclaimed.taxCents} />
            </div>
          )}
          {unclaimed.tipCents > 0 && (
            <div className="flex justify-between">
              <span>Tip share</span>
              <Money cents={unclaimed.tipCents} />
            </div>
          )}
          {/* The discount comes OFF this bucket: a leading minus sign (U+2212,
              which lines up with Money's tabular figures) keeps these lines
              summing to the badge above. */}
          {unclaimed.discountCents > 0 && (
            <div className="flex justify-between">
              <span>Discount share</span>
              <span className="tabular">
                −<Money cents={unclaimed.discountCents} />
              </span>
            </div>
          )}
        </div>
      )}

      <p className="text-sm text-[#6f5a00]">Still unclaimed — nudge the table.</p>
    </Card>
  );
}
