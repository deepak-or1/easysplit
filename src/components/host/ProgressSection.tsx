"use client";

import type { RoomState } from "@/lib/types";
import { fIsZero } from "@/lib/fraction";
import { Avatar, Card, Money, ProgressBar } from "@/components/ui";

export function ProgressSection({ room }: { room: RoomState }) {
  const { split, settlement, items, participants } = room;
  const claimedItems = items.filter((it) => fIsZero(it.remaining)).length;
  const claimedCents = settlement.grandTotalCents - settlement.unclaimed.totalCents;

  return (
    <Card className="animate-[var(--animate-rise)] space-y-3 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-lg font-semibold">
          {claimedItems} of {items.length} {items.length === 1 ? "item" : "items"} claimed
        </p>
        <p className="text-sm text-muted">
          <Money cents={claimedCents} className="font-medium text-ink" /> of{" "}
          <Money cents={settlement.grandTotalCents} />
        </p>
      </div>

      <ProgressBar ratio={settlement.claimedRatio} />

      <div className="flex items-center justify-between gap-2 pt-1">
        <AvatarStack names={participants.map((p) => p.name)} />
        <p className="shrink-0 text-sm text-muted">
          {split.groupSize
            ? `${participants.length} of ${split.groupSize} joined`
            : `${participants.length} ${participants.length === 1 ? "person" : "people"} at the table`}
        </p>
      </div>
    </Card>
  );
}

function AvatarStack({ names }: { names: string[] }) {
  if (names.length === 0) {
    return <p className="text-sm text-muted">No one’s joined yet.</p>;
  }
  const shown = names.slice(0, 6);
  const extra = names.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((name, i) => (
        <Avatar key={`${name}-${i}`} name={name} className="ring-2 ring-card" />
      ))}
      {extra > 0 && (
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-cream text-xs font-semibold text-muted ring-2 ring-card">
          +{extra}
        </span>
      )}
    </div>
  );
}
