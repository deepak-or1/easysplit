"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { getStoredHostKey } from "@/lib/api";
import type { Participant, Settlement, Split } from "@/lib/types";
import { Avatar, Money, ProgressBar } from "@/components/ui";
import { BirthdayMark } from "./BirthdayMark";

// localStorage never notifies us; a no-op subscription is enough for a
// read-once client value (the server snapshot keeps hydration consistent).
const noopSubscribe = () => () => {};

/** "Maya" · "Maya and Sam" · "Maya, Sam and you" */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function RoomHeader({
  split,
  splitId,
  settlement,
  participants,
  meId,
}: {
  split: Split;
  splitId: string;
  settlement: Settlement;
  participants: Participant[];
  meId: string;
}) {
  const grand = settlement.grandTotalCents;
  const claimed = grand - settlement.unclaimed.totalCents;
  // Claiming is about ITEMS, not money — a fully comped bill is entirely
  // claimed and still adds up to $0, which money-based tests read as "nobody
  // has claimed anything". An empty receipt (subtotal 0) counts as nothing
  // claimed, exactly as the old `claimed <= 0` did.
  const fullyClaimed = settlement.subtotalCents > 0 && settlement.unclaimed.itemsCents === 0;
  const nothingClaimed = settlement.unclaimed.itemsCents === settlement.subtotalCents;
  const date = formatDate(split.date);

  const shown = participants.slice(0, 6);
  const overflow = participants.length - shown.length;
  const birthdays = participants.filter((p) => p.isBirthday);

  // The host lands here from their own link all the time; if this browser holds
  // the host key, give them the door back to the dashboard. Client-only read.
  const isHost = useSyncExternalStore(
    noopSubscribe,
    () => getStoredHostKey(splitId) !== null,
    () => false,
  );

  return (
    <header className="animate-[var(--animate-rise)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Grocery rooms wear their kind; a restaurant bill is the default
              and needs no label. */}
          {split.splitType === "grocery" && (
            <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-grocery-soft px-2.5 py-0.5 text-xs font-semibold text-grocery">
              🛒 Grocery run
            </span>
          )}
          <h1 className="truncate font-display text-3xl font-semibold leading-tight text-ink">
            {split.restaurantName ?? (split.splitType === "grocery" ? "Groceries" : "Dinner")}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {date ? `${date} · ` : ""}
            hosted by {split.hostName}
          </p>
          {isHost && (
            <Link
              href={`/split/${splitId}/host`}
              className="mt-1 inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Host dashboard →
            </Link>
          )}
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

      {birthdays.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-gold-soft px-3.5 py-2.5 text-sm text-[#6f5a00]">
          <BirthdayMark />
          <span>
            {listNames(birthdays.map((p) => (p.id === meId ? "you" : p.name)))}{" "}
            {birthdays.length === 1 && birthdays[0].id !== meId ? "isn't" : "aren't"} paying —
            everyone else covers it.
          </span>
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
