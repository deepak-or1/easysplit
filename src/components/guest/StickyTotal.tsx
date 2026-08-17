"use client";

import Link from "next/link";
import { Button, Money } from "@/components/ui";

export interface SelectionAction {
  count: number;
  busy: boolean;
  onClaim: () => void;
  onClear: () => void;
}

export function StickyTotal({
  splitId,
  participantId,
  total,
  hostName,
  hasClaims,
  isBirthday = false,
  birthdayChipInCents = 0,
  selection,
}: {
  splitId: string;
  participantId: string;
  total: number;
  hostName: string;
  hasClaims: boolean;
  /** Birthday people pay $0 — the room already covered them. */
  isBirthday?: boolean;
  /** Everyone else's slice of what the birthday people would have owed. */
  birthdayChipInCents?: number;
  /** Long receipts: the pending multi-select pile, claimed in one POST. */
  selection?: SelectionAction | null;
}) {
  const payHref = `/split/${splitId}/pay/${participantId}`;
  const chipIn = !isBirthday && birthdayChipInCents > 0 ? birthdayChipInCents : 0;

  return (
    <div className="sticky bottom-0 z-40 border-t border-line/70 bg-paper/90 backdrop-blur">
      {selection && selection.count > 0 && (
        <div className="mx-auto flex w-full max-w-md items-center gap-2 px-4 pt-3">
          <Button
            className="flex-1"
            loading={selection.busy}
            onClick={selection.onClaim}
          >
            {selection.count === 1 ? "This one's mine" : `These ${selection.count} are mine`}
          </Button>
          <Button variant="ghost" disabled={selection.busy} onClick={selection.onClear}>
            Clear
          </Button>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 py-3">
        {/* The amount never shrinks or wraps — a long host name wraps the
            button label to two lines instead. */}
        <div className="shrink-0">
          <p className="whitespace-nowrap text-xs font-medium uppercase tracking-wider text-muted">
            Your share
          </p>
          <Money cents={total} className="whitespace-nowrap font-display text-2xl font-semibold text-ink" />
          {isBirthday ? (
            <p className="whitespace-nowrap text-xs font-medium text-success">
              covered by the table 🎂
            </p>
          ) : chipIn > 0 ? (
            <p className="whitespace-nowrap text-xs text-muted">
              includes +<Money cents={chipIn} /> birthday chip-in 🎂
            </p>
          ) : null}
        </div>

        {isBirthday ? (
          <span className="inline-flex cursor-default items-center justify-center rounded-full bg-success-soft px-5 py-3 text-center text-[15px] font-semibold leading-snug text-success">
            Happy birthday — you&apos;re covered
          </span>
        ) : hasClaims ? (
          <Link
            href={payHref}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-center text-[15px] font-semibold leading-snug text-white shadow-[0_4px_14px_-4px_rgb(229_72_77/0.5)] transition-all hover:bg-primary-deep active:scale-[0.97]"
          >
            Pay {hostName} on Venmo
          </Link>
        ) : (
          <span className="inline-flex cursor-default items-center justify-center whitespace-nowrap rounded-full bg-cream px-5 py-3 text-[15px] font-semibold text-muted">
            Nothing claimed yet
          </span>
        )}
      </div>
    </div>
  );
}
