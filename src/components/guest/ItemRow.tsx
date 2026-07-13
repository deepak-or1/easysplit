"use client";

import { useState } from "react";
import clsx from "clsx";
import type { ClaimAction, ItemWithClaims, Participant, Frac } from "@/lib/types";
import type { ClaimResponse } from "@/lib/api";
import { F_ONE, F_ZERO, fadd, fcmp, formatFrac, fr } from "@/lib/fraction";
import { Avatar, Badge, Chip, Money, Spinner } from "@/components/ui";
import { SplitPicker } from "./SplitPicker";

function nameFor(participants: Participant[], id: string): string {
  return participants.find((p) => p.id === id)?.name ?? "?";
}

/** Cents still open on this line = totalCents × remaining / quantity (display hint only). */
function remainingCents(item: ItemWithClaims): number {
  return Math.round((item.totalCents * item.remaining.n) / (item.remaining.d * item.quantity));
}

export function ItemRow({
  item,
  participants,
  participantId,
  onClaim,
}: {
  item: ItemWithClaims;
  participants: Participant[];
  participantId: string;
  onClaim: (actions: ClaimAction[]) => Promise<ClaimResponse | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);

  const myClaim = item.claims.find((c) => c.participantId === participantId);
  const mine = myClaim?.share;
  const remaining = item.remaining;
  const isOpen = fcmp(remaining, F_ZERO) > 0;
  const partial = isOpen && fcmp(item.claimedShare, F_ZERO) > 0;

  async function act(actions: ClaimAction[]) {
    if (busy) return;
    setBusy(true);
    try {
      await onClaim(actions);
    } finally {
      setBusy(false);
    }
  }

  // Quick claim: tapping an open row I haven't claimed takes min(remaining, 1 unit).
  const canQuickClaim = !item.sharedByAll && !mine && isOpen;
  const quickShare: Frac = fcmp(remaining, F_ONE) <= 0 ? remaining : F_ONE;

  // Chips for a row I've claimed: preset shares + split + remove.
  const maxForMe = mine ? fadd(mine, remaining) : remaining;
  const shareChips: { label: string; frac: Frac }[] = [
    { label: "½", frac: fr(1, 2) },
    { label: "⅓", frac: fr(1, 3) },
    { label: "1", frac: fr(1) },
  ];
  for (let k = 2; k <= item.quantity; k++) shareChips.push({ label: String(k), frac: fr(k) });

  const claimants = item.claims;

  return (
    <div className={clsx("py-3", busy && "opacity-60")}>
      <button
        type="button"
        disabled={!canQuickClaim || busy}
        onClick={() =>
          void act([{ type: "set", itemId: item.id, participantId, share: quickShare }])
        }
        className={clsx(
          "flex w-full items-center gap-3 rounded-lg text-left -mx-1 px-1 min-h-[44px]",
          canQuickClaim && "transition-colors hover:bg-cream active:bg-cream cursor-pointer",
          !canQuickClaim && "cursor-default",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="font-medium text-ink">{item.name}</span>
          {item.quantity > 1 && (
            <span className="ml-1.5 tabular text-sm text-muted">×{item.quantity}</span>
          )}
        </span>
        <Money cents={item.totalCents} className="font-display font-semibold text-ink" />
        {busy && <Spinner className="size-4" />}
      </button>

      {/* Claim state */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-0.5">
        {item.sharedByAll ? (
          <Badge tone="gold">Shared by everyone</Badge>
        ) : claimants.length === 0 ? (
          <span className="text-xs text-muted">
            {isOpen ? "Tap to claim →" : ""}
          </span>
        ) : (
          <>
            {claimants.map((c) => {
              const isMe = c.participantId === participantId;
              return (
                <span
                  key={c.participantId}
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2",
                    isMe ? "bg-success-soft ring-1 ring-success/40" : "bg-cream",
                  )}
                >
                  <Avatar name={nameFor(participants, c.participantId)} size="sm" />
                  <span
                    className={clsx(
                      "text-xs font-semibold",
                      isMe ? "text-success" : "text-muted",
                    )}
                  >
                    {formatFrac(c.share)}
                  </span>
                </span>
              );
            })}
            {partial && (
              <span className="text-xs text-muted">
                · <Money cents={remainingCents(item)} /> left
              </span>
            )}
          </>
        )}
        {!item.sharedByAll && !mine && (
          <Chip
            active={splitOpen}
            disabled={busy}
            className="ml-auto px-3 py-1 text-xs"
            onClick={() => setSplitOpen((v) => !v)}
          >
            Split…
          </Chip>
        )}
      </div>

      {/* Controls for a row I've claimed */}
      {mine && !item.sharedByAll && (
        <div className="no-scrollbar mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {shareChips.map((chip) => {
            const active = fcmp(mine, chip.frac) === 0;
            const disabled = !active && fcmp(chip.frac, maxForMe) > 0;
            return (
              <Chip
                key={chip.label}
                active={active}
                disabled={busy || disabled}
                onClick={() =>
                  void act([
                    { type: "set", itemId: item.id, participantId, share: chip.frac },
                  ])
                }
              >
                {chip.label}
              </Chip>
            );
          })}
          <Chip active={splitOpen} disabled={busy} onClick={() => setSplitOpen((v) => !v)}>
            Split…
          </Chip>
          <Chip
            disabled={busy}
            className="border-danger/30 text-danger hover:border-danger"
            onClick={() => void act([{ type: "unclaim", itemId: item.id, participantId }])}
          >
            ✕ Remove
          </Chip>
        </div>
      )}

      {splitOpen && !item.sharedByAll && (
        <SplitPicker
          item={item}
          participants={participants}
          participantId={participantId}
          busy={busy}
          onConfirm={(ids) =>
            void act([{ type: "split", itemId: item.id, participantIds: ids }]).then(() =>
              setSplitOpen(false),
            )
          }
          onCancel={() => setSplitOpen(false)}
        />
      )}
    </div>
  );
}
