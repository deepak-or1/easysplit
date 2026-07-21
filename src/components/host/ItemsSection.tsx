"use client";

import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import type { ItemWithClaims, RoomState, TipType } from "@/lib/types";
import { patchSplit } from "@/lib/api";
import { centsToDollarString, dollarsToCents } from "@/lib/money";
import { F_ONE, fcmp, fIsNeg, fIsZero, formatFrac } from "@/lib/fraction";
import { Avatar, Badge, Button, Chip, ErrorNote, Input, Money } from "@/components/ui";

type ApplyState = (state: RoomState) => void;

interface Props {
  room: RoomState;
  splitId: string;
  hostKey: string;
  applyState: ApplyState;
}

export function ItemsSection(props: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <section className="animate-[var(--animate-rise)] space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-display text-xl font-semibold">Receipt</h2>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit receipt
          </Button>
        )}
      </div>

      {editing ? (
        <ReceiptEditor {...props} onDone={() => setEditing(false)} />
      ) : (
        <ReceiptView room={props.room} />
      )}
    </section>
  );
}

/* ------------------------------- read view ------------------------------- */

function ReceiptView({ room }: { room: RoomState }) {
  const { items, settlement, split, receipt } = room;
  const nameById = useMemo(
    () => Object.fromEntries(room.participants.map((p) => [p.id, p.name])),
    [room.participants],
  );

  const tipLabel = split.tipType === "percent" ? `Tip (${split.tipValue}%)` : "Tip";

  return (
    <>
      <div className="receipt-edge px-5">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No items on this receipt yet.</p>
        ) : (
          <ul>
            {items.map((item, i) => (
              <li key={item.id}>
                {i > 0 && <hr className="receipt-rule" />}
                <ItemRow item={item} nameById={nameById} participantCount={room.participants.length} />
              </li>
            ))}
          </ul>
        )}

        <hr className="receipt-rule mt-1" />
        <dl className="space-y-1.5 py-3 text-sm">
          <SummaryRow label="Subtotal" cents={settlement.subtotalCents} />
          {settlement.taxCents > 0 && <SummaryRow label="Tax" cents={settlement.taxCents} />}
          {settlement.tipCents > 0 && <SummaryRow label={tipLabel} cents={settlement.tipCents} />}
        </dl>
        <hr className="receipt-rule" />
        <div className="flex items-baseline justify-between py-3">
          <span className="font-display text-lg font-semibold">Total</span>
          <Money cents={settlement.grandTotalCents} className="font-display text-lg font-semibold" />
        </div>
      </div>

      {receipt.imageUrl && <OriginalReceipt url={receipt.imageUrl} />}
    </>
  );
}

function ItemRow({
  item,
  nameById,
  participantCount,
}: {
  item: ItemWithClaims;
  nameById: Record<string, string>;
  participantCount: number;
}) {
  const remaining = item.remaining;
  const hasRemainder = !fIsZero(remaining) && !fIsNeg(remaining);

  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-medium text-ink">{item.name}</span>
          {item.quantity > 1 && (
            <span className="shrink-0 text-xs text-muted tabular">×{item.quantity}</span>
          )}
        </div>
        <Money cents={item.totalCents} className="shrink-0 font-medium" />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {item.sharedByAll ? (
          participantCount > 0 ? (
            <span className="text-xs font-medium text-muted">Split evenly by everyone</span>
          ) : (
            <Badge tone="gold">unclaimed</Badge>
          )
        ) : (
          <>
            {item.claims.map((c) => {
              const showShare = fcmp(c.share, F_ONE) !== 0;
              return (
                <span
                  key={c.participantId}
                  className="inline-flex items-center gap-1 text-xs text-muted"
                >
                  <Avatar size="sm" name={nameById[c.participantId] ?? "?"} />
                  <span className="font-medium text-ink">{nameById[c.participantId] ?? "Someone"}</span>
                  {showShare && <span className="tabular">{formatFrac(c.share)}</span>}
                </span>
              );
            })}
            {hasRemainder && <Badge tone="gold">unclaimed</Badge>}
          </>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted">{label}</dt>
      <dd>
        <Money cents={cents} className="text-ink" />
      </dd>
    </div>
  );
}

function OriginalReceipt({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-line bg-card px-4 py-3 text-sm font-medium text-ink"
      >
        <span>Original receipt</span>
        <span className="text-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-2 overflow-hidden rounded-xl border border-line bg-cream p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded receipt via /api/files */}
          <img
            src={url}
            alt="Original receipt photo"
            className="mx-auto max-h-[28rem] w-auto rounded-lg"
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------- edit mode ------------------------------- */

interface DraftItem {
  key: string;
  id?: string;
  name: string;
  quantity: number;
  price: string; // unit price, dollars
  sharedByAll: boolean;
}

const TIP_PRESETS = [15, 18, 20, 25];

function ReceiptEditor({ room, splitId, hostKey, applyState, onDone }: Props & { onDone: () => void }) {
  const { split } = room;
  const [items, setItems] = useState<DraftItem[]>(() =>
    room.items.map((it) => ({
      key: it.id,
      id: it.id,
      name: it.name,
      quantity: it.quantity,
      price: centsToDollarString(it.unitPriceCents),
      sharedByAll: it.sharedByAll,
    })),
  );
  const [restaurantName, setRestaurantName] = useState(split.restaurantName ?? "");
  const [tipType, setTipType] = useState<TipType>(split.tipType);
  const [tipPercent, setTipPercent] = useState(
    split.tipType === "percent" ? String(split.tipValue) : "20",
  );
  const [tipFlat, setTipFlat] = useState(
    split.tipType === "amount" ? centsToDollarString(split.tipValue) : "",
  );
  const [tax, setTax] = useState(centsToDollarString(split.taxCents));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function patchItem(key: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      { key: nanoid(), name: "", quantity: 1, price: "", sharedByAll: false },
    ]);
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  async function save() {
    setErr(null);
    if (items.length === 0) {
      setErr("Add at least one item before saving.");
      return;
    }
    if (items.some((it) => !it.name.trim())) {
      setErr("Every item needs a name.");
      return;
    }
    setBusy(true);
    try {
      const payloadItems = items.map((it) => {
        const unitPriceCents = Math.max(0, dollarsToCents(it.price));
        const quantity = Math.max(1, Math.round(it.quantity) || 1);
        return {
          ...(it.id ? { id: it.id } : {}),
          name: it.name.trim(),
          quantity,
          unitPriceCents,
          totalCents: unitPriceCents * quantity,
          sharedByAll: it.sharedByAll,
        };
      });
      const tipValue =
        tipType === "percent"
          ? Math.max(0, Number(tipPercent) || 0)
          : Math.max(0, dollarsToCents(tipFlat));
      const next = await patchSplit(splitId, hostKey, {
        restaurantName: restaurantName.trim() || null,
        items: payloadItems,
        tipType,
        tipValue,
        taxCents: Math.max(0, dollarsToCents(tax)),
      });
      applyState(next);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-card border border-line bg-card p-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-muted">Restaurant</span>
        <Input
          value={restaurantName}
          onChange={(e) => setRestaurantName(e.target.value)}
          placeholder="Restaurant name (optional)"
        />
      </label>

      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.key} className="space-y-2.5 rounded-xl border border-line bg-cream/50 p-3">
            <div className="flex items-center gap-2">
              <Input
                value={it.name}
                onChange={(e) => patchItem(it.key, { name: e.target.value })}
                placeholder="Item name"
                className="flex-1"
                maxLength={80}
              />
              <button
                type="button"
                aria-label="Delete item"
                onClick={() => removeItem(it.key)}
                className="grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-danger-soft hover:text-danger"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Stepper
                value={it.quantity}
                onChange={(q) => patchItem(it.key, { quantity: q })}
              />
              <div className="relative min-w-[7rem] flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                  $
                </span>
                <Input
                  value={it.price}
                  onChange={(e) => patchItem(it.key, { price: e.target.value })}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="pl-7 tabular"
                />
              </div>
            </div>

            <Chip
              active={it.sharedByAll}
              onClick={() => patchItem(it.key, { sharedByAll: !it.sharedByAll })}
            >
              {it.sharedByAll ? "✓ Shared by all" : "Shared by all"}
            </Chip>
          </div>
        ))}
      </div>

      <Button variant="secondary" size="sm" onClick={addItem}>
        + Add item
      </Button>

      {/* Tip editor */}
      <div className="space-y-2 border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Tip</span>
          <div className="flex gap-1.5">
            <Chip active={tipType === "percent"} onClick={() => setTipType("percent")}>
              %
            </Chip>
            <Chip active={tipType === "amount"} onClick={() => setTipType("amount")}>
              Flat $
            </Chip>
          </div>
        </div>

        {tipType === "percent" ? (
          <div className="flex flex-wrap items-center gap-2">
            {TIP_PRESETS.map((p) => (
              <Chip
                key={p}
                active={tipPercent === String(p)}
                onClick={() => setTipPercent(String(p))}
              >
                {p}%
              </Chip>
            ))}
            <div className="relative w-24">
              <Input
                value={tipPercent}
                onChange={(e) => setTipPercent(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="pr-7 tabular"
                aria-label="Custom tip percent"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">
                %
              </span>
            </div>
          </div>
        ) : (
          <div className="relative w-32">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              $
            </span>
            <Input
              value={tipFlat}
              onChange={(e) => setTipFlat(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="pl-7 tabular"
              aria-label="Flat tip amount"
            />
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        <span className="text-sm font-medium text-ink">Tax</span>
        <div className="relative w-32">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            $
          </span>
          <Input
            value={tax}
            onChange={(e) => setTax(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="pl-7 tabular"
            aria-label="Tax amount"
          />
        </div>
      </div>

      {err && <ErrorNote message={err} />}

      <div className="sticky bottom-0 -mx-4 -mb-4 flex gap-2 border-t border-line bg-paper/90 px-4 py-3 backdrop-blur">
        <Button variant="secondary" className="flex-1" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" className="flex-1" onClick={save} loading={busy}>
          Save receipt
        </Button>
      </div>
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onChange(Math.max(1, value - 1))}
        className="grid size-9 place-items-center rounded-full border border-line text-lg text-ink transition-colors hover:bg-cream disabled:opacity-40"
        disabled={value <= 1}
      >
        −
      </button>
      <span className="w-7 text-center font-medium tabular">{value}</span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onChange(value + 1)}
        className="grid size-9 place-items-center rounded-full border border-line text-lg text-ink transition-colors hover:bg-cream"
      >
        +
      </button>
    </div>
  );
}
