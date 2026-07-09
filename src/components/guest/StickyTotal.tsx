"use client";

import Link from "next/link";
import { Money } from "@/components/ui";

export function StickyTotal({
  splitId,
  participantId,
  total,
  hostName,
  hasClaims,
}: {
  splitId: string;
  participantId: string;
  total: number;
  hostName: string;
  hasClaims: boolean;
}) {
  const payHref = `/split/${splitId}/pay/${participantId}`;

  return (
    <div className="sticky bottom-0 z-40 border-t border-line/70 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">Your share</p>
          <Money cents={total} className="font-display text-2xl font-semibold text-ink" />
        </div>

        {hasClaims ? (
          <Link
            href={payHref}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-primary px-5 py-3 text-[15px] font-semibold text-white shadow-[0_4px_14px_-4px_rgb(229_72_77/0.5)] transition-all hover:bg-primary-deep active:scale-[0.97]"
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
