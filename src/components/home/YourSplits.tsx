"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getRecentSplits, getRoom } from "@/lib/api";
import { Badge, Card } from "@/components/ui";

/**
 * "Your splits" — there are no accounts, so this browser's localStorage is the
 * only memory of which rooms you've been in. Rendered entirely after mount:
 * the server has nothing to say about it, and the section simply appears.
 */

const MAX_ROWS = 8;
/** Rooms created before the registry existed; found by their host keys. */
const MAX_BACKFILL = 10;
const HOST_KEY_RE = /^settle:(.+):hostKey$/;

interface Row {
  splitId: string;
  name: string;
  role: "host" | "guest";
  at: string | null; // backfilled rooms have no timestamp
}

function fallbackName(splitId: string): string {
  return `Split ${splitId.slice(0, 6)}`;
}

/** Every room this browser holds a host key for, oldest-known ordering. */
function hostKeySplitIds(): string[] {
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const match = HOST_KEY_RE.exec(localStorage.key(i) ?? "");
      if (match) ids.push(match[1]);
    }
  } catch {
    /* storage blocked (private mode, embedded webview) — no backfill, no crash */
  }
  return ids;
}

/** "just now" · "20m ago" · "3h ago" · "yesterday" · "Jul 12" */
function relativeDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const minutes = Math.round((Date.now() - t) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Registry rooms first (newest first, they carry timestamps), then the
 * backfilled host-key rooms with a placeholder name. */
function readRows(): Row[] {
  const recents = getRecentSplits();
  const known = new Set(recents.map((r) => r.splitId));
  const legacy = hostKeySplitIds()
    .filter((id) => !known.has(id))
    .slice(0, MAX_BACKFILL);
  return [
    ...recents.map((r) => ({ splitId: r.splitId, name: r.name, role: r.role, at: r.at })),
    ...legacy.map((id) => ({
      splitId: id,
      name: fallbackName(id),
      role: "host" as const,
      at: null,
    })),
  ];
}

// localStorage never notifies us; a no-op subscription is enough for a
// read-once client value (the server snapshot keeps hydration consistent).
const noopSubscribe = () => () => {};

export function YourSplits() {
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const base = useMemo<Row[]>(() => (hydrated ? readRows() : []), [hydrated]);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    // Names for the backfilled rooms come from the public room state, one
    // lazy fetch each. Their rows are already on screen with a placeholder, so
    // a slow or failed fetch costs nothing but the nicer label.
    const legacy = base.filter((r) => r.at === null).map((r) => r.splitId);
    if (legacy.length === 0) return;
    let alive = true;
    void Promise.all(
      legacy.map(async (id) => {
        try {
          const room = await getRoom(id);
          const name =
            room.split.restaurantName?.trim() ||
            (room.split.splitType === "grocery" ? "Grocery run" : "Dinner");
          return [id, name] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!alive) return;
      setNames(Object.fromEntries(results.filter((r): r is readonly [string, string] => r !== null)));
    });
    return () => {
      alive = false;
    };
  }, [base]);

  const rows = useMemo(
    () => base.map((row) => (names[row.splitId] ? { ...row, name: names[row.splitId] } : row)),
    [base, names],
  );

  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-4 animate-[var(--animate-rise)]">
      <h2 className="text-center font-display text-2xl font-semibold text-ink">Your splits</h2>
      <Card className="divide-y divide-line/70">
        {rows.slice(0, MAX_ROWS).map((row) => {
          const when = relativeDate(row.at);
          return (
            <Link
              key={row.splitId}
              href={row.role === "host" ? `/split/${row.splitId}/host` : `/split/${row.splitId}`}
              className="flex min-h-[44px] items-center gap-3 px-4 py-3 transition-colors first:rounded-t-card last:rounded-b-card hover:bg-cream/70"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{row.name}</span>
                {when && <span className="block text-xs text-muted">{when}</span>}
              </span>
              <Badge tone={row.role === "host" ? "primary" : "neutral"}>
                {row.role === "host" ? "host" : "guest"}
              </Badge>
              <span className="text-muted" aria-hidden>
                →
              </span>
            </Link>
          );
        })}
      </Card>
      <p className="text-center text-xs text-muted">
        Saved on this device only — no accounts, remember?
      </p>
    </section>
  );
}
