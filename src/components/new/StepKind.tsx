"use client";

import clsx from "clsx";
import type { SplitType } from "@/lib/types";

const KINDS: { value: SplitType; emoji: string; title: string; blurb: string }[] = [
  {
    value: "restaurant",
    emoji: "🍽",
    title: "Restaurant",
    blurb: "Everyone claims what they ordered. Tip included.",
  },
  {
    value: "grocery",
    emoji: "🛒",
    title: "Groceries",
    blurb: "One cart, split evenly — no tip, and anyone can grab their own item.",
  },
];

/** Step 1 — KIND. What sort of bill this is, before we read anything: it
 * decides whether items start shared and whether a tip exists at all. */
export function StepKind({
  value,
  onChange,
}: {
  value: SplitType;
  onChange: (splitType: SplitType) => void;
}) {
  return (
    <div className="flex flex-col gap-5 animate-[var(--animate-rise)]">
      <header className="text-center">
        <h1 className="font-display text-2xl font-semibold text-ink">What are we splitting?</h1>
        <p className="mt-1 text-sm text-muted">
          It changes how the receipt behaves — you can&apos;t switch later.
        </p>
      </header>

      <div
        className="flex flex-col gap-3"
        role="radiogroup"
        aria-label="What kind of bill is this?"
      >
        {KINDS.map((kind) => {
          const active = value === kind.value;
          // A grocery run carries its own accent (kraft brown) everywhere it
          // shows up; restaurant is the default identity and stays marker red.
          // The step's CTA is red either way — one CTA colour, app-wide.
          const grocery = kind.value === "grocery";
          return (
            <button
              key={kind.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(kind.value)}
              className={clsx(
                "flex items-center gap-4 rounded-card border bg-card p-5 text-left transition-all",
                "active:scale-[0.99]",
                active
                  ? grocery
                    ? "border-grocery shadow-card ring-2 ring-grocery/25"
                    : "border-primary shadow-card ring-2 ring-primary/25"
                  : "border-line/60 hover:border-muted",
              )}
            >
              <span className="text-4xl leading-none" aria-hidden>
                {kind.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-lg font-semibold text-ink">
                  {kind.title}
                </span>
                <span className="mt-0.5 block text-sm leading-snug text-muted">{kind.blurb}</span>
              </span>
              <span
                aria-hidden
                className={clsx(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-xs font-bold text-white transition-colors",
                  active
                    ? grocery
                      ? "border-grocery bg-grocery"
                      : "border-primary bg-primary"
                    : "border-line bg-card",
                )}
              >
                {active ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
