"use client";

import { useState } from "react";
import clsx from "clsx";
import type { ItemWithClaims, Participant } from "@/lib/types";
import { F_ZERO, formatFrac, fr } from "@/lib/fraction";
import { Avatar, Button, Money } from "@/components/ui";
import { BirthdayMark } from "./BirthdayMark";

/**
 * Inline people-picker for splitting one item among a chosen group.
 * The picked set is authoritative: confirming splits the whole item evenly
 * among the selected people and removes anyone left unpicked (sent as
 * `unclaim` actions ahead of the `split`) — so the preview always matches
 * what will actually happen, and un-splitting someone is just unpicking them.
 */
export function SplitPicker({
  item,
  participants,
  participantId,
  busy,
  onConfirm,
  onCancel,
}: {
  item: ItemWithClaims;
  participants: Participant[];
  participantId: string;
  busy: boolean;
  onConfirm: (participantIds: string[]) => void;
  onCancel: () => void;
}) {
  // Fresh item → everyone (one tap = classic even split). Item with claims →
  // its claimants + you ("actually, we shared that").
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => {
    const claimants = item.claims.map((c) => c.participantId);
    return new Set(claimants.length > 0 ? [...claimants, participantId] : participants.map((p) => p.id));
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const n = selected.size;
  const each = n > 0 ? fr(item.quantity, n) : F_ZERO;
  const eachCents = n > 0 ? Math.round(item.totalCents / n) : 0;
  const removedNames = item.claims
    .filter((c) => !selected.has(c.participantId))
    .map((c) => participants.find((p) => p.id === c.participantId)?.name ?? "?");

  return (
    <div className="mt-2.5 rounded-xl border border-line bg-cream/50 p-3 animate-[var(--animate-rise)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Who&apos;s splitting {item.name}?
        </p>
        {participants.length > 1 && (
          <div className="flex gap-2 text-xs font-medium">
            <button
              type="button"
              className="text-muted underline-offset-2 hover:text-ink hover:underline"
              onClick={() => setSelected(new Set(participants.map((p) => p.id)))}
            >
              Everyone
            </button>
            <button
              type="button"
              className="text-muted underline-offset-2 hover:text-ink hover:underline"
              onClick={() => setSelected(new Set([participantId]))}
            >
              Just me
            </button>
          </div>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {participants.map((p) => {
          const on = selected.has(p.id);
          const isMe = p.id === participantId;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(p.id)}
              className={clsx(
                "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition-colors",
                on
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-card text-muted hover:border-muted",
              )}
            >
              <Avatar name={p.name} size="sm" className={clsx(!on && "opacity-50")} />
              {isMe ? "You" : p.name}
              {p.isBirthday && <BirthdayMark name={p.name} />}
            </button>
          );
        })}
      </div>

      {participants.length === 1 ? (
        <p className="mt-2.5 text-xs text-muted">
          It&apos;s just you here so far — share the room link and friends will show up in this
          list.
        </p>
      ) : n > 0 ? (
        <>
          <p className="mt-2.5 text-xs text-muted">
            {formatFrac(each)} each · ≈ <Money cents={eachCents} className="text-ink" />{" "}
            apiece before tax &amp; tip
          </p>
          {removedNames.length > 0 && (
            <p className="mt-1 text-xs text-muted">
              Unpicked, so they come off this item: {removedNames.join(", ")}.
            </p>
          )}
        </>
      ) : (
        <p className="mt-2.5 text-xs text-muted">Pick at least one person.</p>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          disabled={busy || n === 0}
          onClick={() => onConfirm([...selected])}
        >
          {n > 1 ? `Split ${n} ways` : "Claim it"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
