"use client";

import { Button, Card, Input, Money } from "@/components/ui";
import { dollarsToCents, formatCents } from "@/lib/money";
import { GoldNote } from "./GoldNote";
import { TotalsSummary } from "./TotalsSummary";
import {
  computeSubtotalCents,
  itemLineCents,
  newItem,
  type Draft,
  type DraftItem,
} from "./helpers";

/** Step 2 — CHECK. Editable receipt: fix names, quantities, prices; toggle
 * shared items; set restaurant / date / tax. Live footer reconciles the
 * computed subtotal against the OCR-printed one. */
export function StepCheck({
  draft,
  patch,
  warning,
  onDismissWarning,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  warning: string | null;
  onDismissWarning: () => void;
}) {
  const updateItem = (key: string, next: Partial<DraftItem>) =>
    patch({ items: draft.items.map((it) => (it.key === key ? { ...it, ...next } : it)) });
  const deleteItem = (key: string) =>
    patch({ items: draft.items.filter((it) => it.key !== key) });
  const addItem = () => patch({ items: [...draft.items, newItem()] });

  const subtotalCents = computeSubtotalCents(draft.items);
  const ocr = draft.ocrSubtotalCents;
  const mismatch = ocr != null && ocr > 0 && ocr !== subtotalCents;

  return (
    <div className="flex flex-col gap-5 animate-[var(--animate-rise)]">
      <header className="text-center">
        <h1 className="font-display text-2xl font-semibold text-ink">Give it a once-over</h1>
        <p className="mt-1 text-sm text-muted">OCR isn&apos;t perfect — check the names and prices.</p>
      </header>

      {warning && <GoldNote onDismiss={onDismissWarning}>{warning}</GoldNote>}

      {/* Restaurant + date */}
      <Card className="flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Where</span>
          <Input
            value={draft.restaurantName}
            onChange={(e) => patch({ restaurantName: e.target.value })}
            placeholder="Restaurant name"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">When</span>
          <Input type="date" value={draft.date} onChange={(e) => patch({ date: e.target.value })} />
        </label>
      </Card>

      {/* Items */}
      <div className="flex flex-col gap-3">
        {draft.items.map((it) => (
          <div key={it.key} className="flex flex-col gap-2.5 rounded-xl border border-line bg-card p-3">
            <div className="flex items-center gap-2">
              <Input
                value={it.name}
                onChange={(e) => updateItem(it.key, { name: e.target.value })}
                placeholder="Item name"
                className="flex-1"
                aria-label="Item name"
              />
              <button
                type="button"
                onClick={() => deleteItem(it.key)}
                aria-label={`Remove ${it.name || "item"}`}
                className="grid size-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-danger-soft hover:text-danger"
              >
                🗑
              </button>
            </div>
            <div className="flex items-center gap-2">
              <QtyStepper
                value={it.quantity}
                onChange={(q) => updateItem(it.key, { quantity: q })}
              />
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
                  $
                </span>
                <Input
                  value={it.price}
                  onChange={(e) => updateItem(it.key, { price: e.target.value })}
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label="Unit price in dollars"
                  className="pl-7 text-right tabular"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={it.sharedByAll}
                  onChange={(e) => updateItem(it.key, { sharedByAll: e.target.checked })}
                  className="size-4 accent-[color:var(--color-primary)]"
                />
                Everyone splits this
              </label>
              {it.quantity > 1 && (
                <span className="text-xs text-muted">
                  line <Money cents={itemLineCents(it)} className="text-ink" />
                </span>
              )}
            </div>
          </div>
        ))}

        <Button variant="secondary" size="sm" onClick={addItem} className="self-start">
          + Add item
        </Button>
      </div>

      {/* Tax + live totals */}
      <div className="flex flex-col gap-3 rounded-card bg-cream p-4">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink">Tax</span>
          <div className="relative w-28">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
              $
            </span>
            <Input
              value={draft.tax}
              onChange={(e) => patch({ tax: e.target.value })}
              inputMode="decimal"
              placeholder="0.00"
              aria-label="Tax in dollars"
              className="pl-7 text-right tabular"
            />
          </div>
        </label>
        <hr className="receipt-rule" />
        <TotalsSummary
          itemsCents={subtotalCents}
          taxCents={dollarsToCents(draft.tax)}
          tipCents={draft.ocrTipCents}
          tipLabel="Tip / service (on receipt)"
        />
        {mismatch && (
          <p className="text-xs leading-snug text-[#9a6d13]">
            Heads up — the receipt&apos;s printed subtotal ({formatCents(ocr)}) doesn&apos;t match
            these items ({formatCents(subtotalCents)}). Worth a second look.
          </p>
        )}
      </div>
    </div>
  );
}

function QtyStepper({ value, onChange }: { value: number; onChange: (q: number) => void }) {
  return (
    <div className="flex items-center rounded-full border border-line bg-card">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
        aria-label="Decrease quantity"
        className="grid size-10 place-items-center rounded-full text-lg text-ink disabled:opacity-40"
      >
        −
      </button>
      <span className="w-7 text-center tabular text-sm font-semibold">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="Increase quantity"
        className="grid size-10 place-items-center rounded-full text-lg text-ink"
      >
        +
      </button>
    </div>
  );
}
