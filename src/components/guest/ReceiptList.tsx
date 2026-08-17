"use client";

import { useMemo, useState } from "react";
import type { ClaimAction, ItemWithClaims, Participant } from "@/lib/types";
import type { ClaimResponse } from "@/lib/api";
import { EmptyState, Input } from "@/components/ui";
import { ItemRow } from "./ItemRow";
import { filterItems, groupItems, isLongReceipt } from "./list-helpers";

interface RowProps {
  participants: Participant[];
  participantId: string;
  onClaim: (actions: ClaimAction[]) => Promise<ClaimResponse | null>;
  canTakeover: boolean;
}

export function ReceiptList({
  items,
  participants,
  participantId,
  onClaim,
  canTakeover = false,
  selected,
  onToggleSelect,
}: {
  items: ItemWithClaims[];
  participants: Participant[];
  participantId: string;
  onClaim: (actions: ClaimAction[]) => Promise<ClaimResponse | null>;
  /** Grocery rooms: shared items can be taken over by one person. */
  canTakeover?: boolean;
  /** Long receipts only — the accumulating "these are mine" pile. */
  selected?: ReadonlySet<string>;
  onToggleSelect?: (itemId: string) => void;
}) {
  const rowProps: RowProps = { participants, participantId, onClaim, canTakeover };

  if (items.length === 0) {
    return (
      <div className="receipt-edge rounded-sm px-5">
        <EmptyState emoji="🧾" title="No items yet" hint="The host is still setting up the receipt." />
      </div>
    );
  }

  // A short receipt is just a receipt: no search, no groups, nothing to learn.
  if (!isLongReceipt(items)) {
    return (
      <div className="receipt-edge px-5">
        <Rows items={items} {...rowProps} />
      </div>
    );
  }

  return (
    <LongReceipt
      items={items}
      rowProps={rowProps}
      selected={selected ?? EMPTY_SELECTION}
      onToggleSelect={onToggleSelect}
    />
  );
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();

/** A long receipt — a grocery haul, a big table — needs finding, not scrolling. */
function LongReceipt({
  items,
  rowProps,
  selected,
  onToggleSelect,
}: {
  items: ItemWithClaims[];
  rowProps: RowProps;
  selected: ReadonlySet<string>;
  onToggleSelect?: (itemId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [showClaimed, setShowClaimed] = useState(false);

  const groups = useMemo(
    () => groupItems(filterItems(items, query), rowProps.participantId),
    [items, query, rowProps.participantId],
  );
  const matches = groups.unclaimed.length + groups.yours.length + groups.claimed.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${items.length} items…`}
          aria-label="Search the receipt"
          type="search"
          className={query ? "pr-11" : undefined}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>

      {matches === 0 ? (
        <div className="receipt-edge rounded-sm px-5">
          <EmptyState
            emoji="🔍"
            title="Nothing matches that"
            hint="Try a shorter word — “milk” instead of “oat milk 64oz”."
          />
        </div>
      ) : (
        <>
          {groups.unclaimed.length > 0 && (
            <Section
              title="Unclaimed"
              count={groups.unclaimed.length}
              hint={onToggleSelect ? "Tick a few, then claim them in one go." : undefined}
            >
              <Rows
                items={groups.unclaimed}
                {...rowProps}
                selectable={!!onToggleSelect}
                selected={selected}
                onToggleSelect={onToggleSelect}
              />
            </Section>
          )}

          {groups.yours.length > 0 && (
            <Section title="Yours" count={groups.yours.length}>
              <Rows items={groups.yours} {...rowProps} />
            </Section>
          )}

          {groups.claimed.length > 0 && (
            <Section
              title="Claimed"
              count={groups.claimed.length}
              action={
                <button
                  type="button"
                  onClick={() => setShowClaimed((v) => !v)}
                  aria-expanded={showClaimed}
                  className="text-xs font-semibold text-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  {showClaimed ? "Hide" : `Show ${groups.claimed.length}`}
                </button>
              }
            >
              {showClaimed ? (
                <Rows items={groups.claimed} {...rowProps} />
              ) : (
                <p className="py-3 text-sm text-muted">
                  {groups.claimed.length} {groups.claimed.length === 1 ? "item" : "items"} someone
                  else already took.
                </p>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  hint,
  action,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {title} <span className="tabular font-normal">({count})</span>
        </h3>
        {action}
      </div>
      {hint && <p className="mb-1.5 px-1 text-xs text-muted">{hint}</p>}
      <div className="receipt-edge px-5">{children}</div>
    </section>
  );
}

function Rows({
  items,
  participants,
  participantId,
  onClaim,
  canTakeover,
  selectable = false,
  selected,
  onToggleSelect,
}: RowProps & {
  items: ItemWithClaims[];
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onToggleSelect?: (itemId: string) => void;
}) {
  return (
    <>
      {items.map((item, i) => (
        <div key={item.id}>
          {i > 0 && <hr className="receipt-rule" />}
          <ItemRow
            item={item}
            participants={participants}
            participantId={participantId}
            onClaim={onClaim}
            canTakeover={canTakeover}
            selectable={selectable}
            selected={selected?.has(item.id) ?? false}
            onToggleSelect={onToggleSelect}
          />
        </div>
      ))}
    </>
  );
}
