"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { RoomState } from "@/lib/types";
import { getStoredHostKey, storeHostKey } from "@/lib/api";
import { useRoom } from "@/lib/use-room";
import { Button, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { ShareCard } from "./ShareCard";
import { ProgressSection } from "./ProgressSection";
import { ItemsSection } from "./ItemsSection";
import { PeopleSection } from "./PeopleSection";
import { UnclaimedPanel } from "./UnclaimedPanel";

// localStorage never notifies; a no-op subscription suffices for read-once
// client values (the server snapshot keeps hydration consistent).
const noopSubscribe = () => () => {};

export function HostDashboard({ splitId }: { splitId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Auth-lite: prefer a fresh ?key= (persisted + stripped below), else localStorage.
  const urlKey = searchParams.get("key");
  const keyReady = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const storedKey = useSyncExternalStore(
    noopSubscribe,
    () => getStoredHostKey(splitId),
    () => null,
  );
  const hostKey = urlKey ?? storedKey;

  // Side effects only: persist the key from the URL, then strip it from the
  // address bar (after which storedKey takes over seamlessly).
  useEffect(() => {
    if (urlKey) {
      storeHostKey(splitId, urlKey);
      router.replace(`/split/${splitId}/host`);
    }
  }, [splitId, urlKey, router]);

  const { room, error, isLoading, mutate } = useRoom(splitId);

  const applyState = useMemo(
    () => (state: RoomState) => {
      void mutate(state, { revalidate: false });
    },
    [mutate],
  );

  const settled = useMemo(() => {
    if (!room) return false;
    const nonHost = room.participants.filter((p) => !p.isHost);
    const everyoneConfirmed =
      nonHost.length > 0 && nonHost.every((p) => p.paidStatus === "confirmed");
    return room.settlement.claimedRatio >= 1 && everyoneConfirmed;
  }, [room]);

  if (!keyReady) return <CenterSpinner />;

  if (!hostKey) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <Card className="p-6">
          <EmptyState
            emoji="🔑"
            title="Host access only"
            hint="This page is for the person who started the split. If that's you, open it from the original link you were given — it carries your host key."
            action={
              <Link href={`/split/${splitId}`} className="mt-2">
                <Button variant="secondary">Open the room as a guest</Button>
              </Link>
            }
          />
        </Card>
      </main>
    );
  }

  if (isLoading && !room) return <CenterSpinner />;

  if (error && !room) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-10">
        <ErrorNote message={error instanceof Error ? error.message : "Couldn't load this split."} />
        <Button variant="secondary" onClick={() => void mutate()}>
          Try again
        </Button>
        <Link href={`/split/${splitId}`} className="text-center text-sm text-muted underline">
          Open the room as a guest
        </Link>
      </main>
    );
  }

  if (!room) return <CenterSpinner />;

  const title = room.split.restaurantName?.trim() || "Your split";

  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-5 px-4 pb-16 pt-6">
      <header className="animate-[var(--animate-rise)] space-y-1">
        <p className="text-sm font-medium text-muted">Host dashboard</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="text-sm text-muted">
          Share the link, keep the receipt honest, and settle up.
        </p>
      </header>

      {settled && (
        <Card className="animate-[var(--animate-pop)] border-success/40 bg-success-soft p-5 text-center">
          <p className="font-display text-2xl font-semibold text-success">All settled 🎉</p>
          <p className="mt-1 text-sm text-success/90">
            Everything’s claimed and everyone paid up. Nice work.
          </p>
        </Card>
      )}

      <ShareCard splitId={splitId} />

      <ProgressSection room={room} />

      <ItemsSection room={room} splitId={splitId} hostKey={hostKey} applyState={applyState} />

      {room.settlement.unclaimed.totalCents > 0 && (
        <UnclaimedPanel unclaimed={room.settlement.unclaimed} items={room.items} />
      )}

      <PeopleSection room={room} splitId={splitId} hostKey={hostKey} applyState={applyState} />

      <div className="pt-2 text-center">
        <Link
          href={`/split/${splitId}`}
          className="text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink"
        >
          Open the room as a guest →
        </Link>
      </div>
    </main>
  );
}

function CenterSpinner() {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <Spinner className="size-7" />
    </div>
  );
}
