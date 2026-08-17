"use client";

import clsx from "clsx";
import { useState } from "react";
import type { PersonSettlement } from "@/lib/types";
import { Card, Money } from "@/components/ui";

/** A single label/amount line inside the breakdown. */
function Line({
  label,
  cents,
  tone = "normal",
  negative,
}: {
  label: string;
  cents: number;
  tone?: "normal" | "muted" | "strong";
  /** Render as money coming OFF the bill: a leading minus sign (U+2212, which
   * lines up with Money's tabular figures) rather than a negative amount. */
  negative?: boolean;
}) {
  const amountClass = clsx(
    "shrink-0",
    tone === "muted" && "text-sm text-muted",
    tone === "strong" && "font-display text-lg font-semibold text-ink",
    tone === "normal" && "text-[15px] font-medium text-ink",
  );
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span
        className={clsx(
          "min-w-0",
          tone === "muted" && "text-sm text-muted",
          tone === "strong" && "font-display text-lg font-semibold text-ink",
          tone === "normal" && "text-[15px] text-ink",
        )}
      >
        {label}
      </span>
      {negative ? (
        <span className={clsx(amountClass, "tabular")}>
          −<Money cents={cents} />
        </span>
      ) : (
        <Money cents={cents} className={amountClass} />
      )}
    </div>
  );
}

/**
 * The hero of the pay page: their total, huge, with an expandable receipt-style
 * breakdown of how we got there. Collapsed by default (mobile-first).
 */
export function TotalCard({ ps, settled }: { ps: PersonSettlement; settled?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="overflow-hidden animate-[var(--animate-rise)]">
      <div className="px-6 pt-7 pb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
          {settled ? "You settled" : "You owe"}
        </p>
        <Money
          cents={ps.totalCents}
          className={clsx(
            "mt-1 block font-display text-6xl font-semibold leading-none",
            settled ? "text-success" : "text-ink",
          )}
        />
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-center gap-1.5 border-t border-line/70 px-4 py-3 text-sm font-medium text-muted transition-colors hover:text-ink"
      >
        {open ? "Hide the breakdown" : "How we got this"}
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={clsx("size-3 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-5 pt-1">
          <div className="receipt-edge px-5">
            {ps.lines.map((l, i) => (
              <div key={`${l.itemId}-${i}`}>
                {i > 0 && <hr className="receipt-rule" />}
                <Line label={l.label} cents={l.amountCents} />
              </div>
            ))}
            <hr className="receipt-rule" />
            <Line label="Items subtotal" cents={ps.itemsCents} tone="muted" />
            <Line label="Your share of tax" cents={ps.taxCents} tone="muted" />
            <Line label="Your share of tip" cents={ps.tipCents} tone="muted" />
            {ps.discountCents > 0 && (
              <Line label="Discount" cents={ps.discountCents} tone="muted" negative />
            )}
            {ps.birthdayAdjustmentCents > 0 && (
              <Line label="Birthday chip-in 🎂" cents={ps.birthdayAdjustmentCents} tone="muted" />
            )}
            <hr className="receipt-rule" />
            <Line label="Total" cents={ps.totalCents} tone="strong" />
          </div>
        </div>
      )}
    </Card>
  );
}
