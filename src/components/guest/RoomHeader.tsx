"use client";

import type { Participant, Settlement, Split } from "@/lib/types";
import { Avatar, Money, ProgressBar } from "@/components/ui";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function RoomHeader({
  split,
  settlement,
  participants,
  meId,
}: {
  split: Split;
  settlement: Settlement;
  participants: Participant[];
  meId: string;
}) {
  const grand = settlement.grandTotalCents;
  const claimed = grand - settlement.unclaimed.totalCents;
  const fullyClaimed = grand > 0 && settlement.unclaimed.totalCents === 0;
  const nothingClaimed = claimed <= 0;
  const date = formatDate(split.date);

  const shown = participants.slice(0, 6);
  const overflow = participants.length - shown.length;

  return (
    <header className="animate-[var(--animate-rise)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-3xl font-semibold leading-tight text-ink">
            {split.restaurantName ?? "Dinner"}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {date ? `${date} · ` : ""}
            hosted by {split.hostName}
          </p>
        </div>
        <div className="flex shrink-0 -space-x-2 pt-1">
          {shown.map((p) => (
            <Avatar
              key={p.id}
              name={p.name}
              className={p.id === meId ? "ring-2 ring-primary" : "ring-2 ring-paper"}
            />
          ))}
          {overflow > 0 && (
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-cream text-xs font-semibold text-muted ring-2 ring-paper">
              +{overflow}
            </span>
          )}
        </div>
      </div>

      {fullyClaimed ? (
        <div className="mt-4 rounded-card bg-success-soft px-4 py-3 text-center">
          <p className="font-display text-lg font-semibold text-success">
            That&apos;s the whole bill. Time to settle up 🎉
          </p>
        </div>
      ) : (
        <p className="mt-3 text-[15px] text-ink">
          {nothingClaimed
            ? "Nothing claimed yet — dibs on the fries?"
            : "Everyone claims what they got."}
        </p>
      )}

      <div className="mt-3">
        <ProgressBar ratio={settlement.claimedRatio} />
        <p className="mt-1.5 text-sm text-muted">
          <Money cents={Math.max(0, claimed)} className="font-semibold text-ink" /> of{" "}
          <Money cents={grand} /> claimed
        </p>
      </div>
    </header>
  );
}
