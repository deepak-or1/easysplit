"use client";

import { useId } from "react";
import { Switch } from "@/components/ui";

/**
 * The "each item on its own line" control that sits above an editable item
 * list. Rendered only when there is something to itemize — a receipt of ×1
 * lines has nothing to break up, and the toggle would just be noise.
 *
 * The caption previews what will change ("Vodka Pasta ×4 → 4 lines") so the
 * host isn't flipping a switch blind. The expansion itself happens where the
 * items are committed (create payload / receipt save), not here.
 */
export function ItemizeToggle({
  lines,
  checked,
  onChange,
  disabled = false,
}: {
  /** Lines with quantity > 1, in receipt order. Empty = render nothing. */
  lines: { name: string; quantity: number }[];
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  if (lines.length === 0) return null;

  const total = lines.reduce((sum, l) => sum + l.quantity, 0);
  const first = lines[0];
  const preview =
    lines.length === 1
      ? `${first.name.trim() || "Item"} ×${first.quantity} → ${first.quantity} lines`
      : `${lines.length} lines → ${total} lines`;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-cream/60 px-3 py-2.5">
      <div className="min-w-0">
        <span id={labelId} className="block text-sm font-medium text-ink">
          Each item on its own line
        </span>
        <span className="block truncate text-xs text-muted">
          {checked ? preview : "Break up ×2, ×3… lines so each one can be split separately."}
        </span>
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-labelledby={labelId}
      />
    </div>
  );
}
