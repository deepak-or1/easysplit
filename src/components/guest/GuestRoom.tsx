"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRoom } from "@/lib/use-room";
import { getStoredParticipantId, sendClaim, type ClaimResponse } from "@/lib/api";
import type { ClaimAction, Participant } from "@/lib/types";
import { Button, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { NameGate } from "./NameGate";
import { RoomHeader } from "./RoomHeader";
import { ReceiptList } from "./ReceiptList";
import { ChatPanel } from "./ChatPanel";
import { StickyTotal } from "./StickyTotal";
import { Toast } from "./Toast";

/** A room load error whose message reads like "not found" is a bad/expired link. */
function looksMissing(message: string): boolean {
  return /not.?found|doesn'?t exist|no such|unknown|expired|404/i.test(message);
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4">{children}</div>
  );
}

// localStorage never notifies us; a no-op subscription is enough for a
// read-once client value (the server snapshot keeps hydration consistent).
const noopSubscribe = () => () => {};

export function GuestRoom({ splitId }: { splitId: string }) {
  const { room, error, isLoading, mutate } = useRoom(splitId);
  // Identity lives in localStorage — server renders "not hydrated", the client
  // re-reads after hydration. Joining this session overrides the stored value.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const storedParticipantId = useSyncExternalStore(
    noopSubscribe,
    () => getStoredParticipantId(splitId),
    () => null,
  );
  const [joinedId, setJoinedId] = useState<string | null>(null);
  const participantId = joinedId ?? storedParticipantId;
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3800);
  }, []);

  const submitClaim = useCallback(
    async (input: {
      actions?: ClaimAction[];
      message?: string;
    }): Promise<ClaimResponse | null> => {
      if (!participantId) return null;
      try {
        const res = await sendClaim(splitId, participantId, input);
        await mutate(res.state, { revalidate: false });
        if (res.rejected.length > 0) {
          showToast(res.rejected.map((r) => r.reason).join("  ·  "));
        }
        return res;
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Something went wrong — try again.");
        return null;
      }
    },
    [splitId, participantId, mutate, showToast],
  );

  const onJoined = useCallback(
    (p: Participant) => {
      // Seed the new participant optimistically so the room shows "me" instantly.
      void mutate(
        (prev) =>
          prev
            ? { ...prev, participants: [...prev.participants.filter((x) => x.id !== p.id), p] }
            : prev,
        { revalidate: true },
      );
      setJoinedId(p.id);
    },
    [mutate],
  );

  // ---- Loading & error gates ----
  if (!hydrated || (isLoading && !room)) {
    return (
      <Screen>
        <Spinner className="size-8" />
      </Screen>
    );
  }

  if (!room) {
    if (error && looksMissing(error.message)) {
      return (
        <Screen>
          <EmptyState
            emoji="🍽️"
            title="This split doesn't exist"
            hint="Double-check the link — it may have a typo or the bill may have been closed."
          />
        </Screen>
      );
    }
    return (
      <Screen>
        <div className="w-full max-w-sm space-y-3 text-center">
          <ErrorNote message={error ? error.message : "Couldn't load this split."} />
          <Button variant="secondary" onClick={() => void mutate()}>
            Try again
          </Button>
        </div>
      </Screen>
    );
  }

  const me = participantId
    ? room.participants.find((p) => p.id === participantId)
    : undefined;

  // Not joined yet — or a stale id that no longer maps to a participant. Re-gate.
  if (!participantId || !me) {
    return (
      <Screen>
        <NameGate split={room.split} splitId={splitId} onJoined={onJoined} />
      </Screen>
    );
  }

  const meSettlement = room.settlement.people.find((p) => p.participantId === participantId);
  const myTotal = meSettlement?.totalCents ?? 0;
  const hasClaims = (meSettlement?.lines.length ?? 0) > 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="mx-auto w-full max-w-md flex-1 px-4 pb-8 pt-6">
        <RoomHeader
          split={room.split}
          settlement={room.settlement}
          participants={room.participants}
          meId={participantId}
        />

        <section className="mt-7">
          <h2 className="mb-2.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted">
            The receipt
          </h2>
          <ReceiptList
            items={room.items}
            participants={room.participants}
            participantId={participantId}
            onClaim={(actions) => submitClaim({ actions })}
          />
        </section>

        <section className="mt-7">
          <h2 className="mb-2.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted">
            Chat
          </h2>
          <ChatPanel
            feed={room.feed}
            participantId={participantId}
            onSend={(message) => submitClaim({ message })}
          />
        </section>
      </div>

      <StickyTotal
        splitId={splitId}
        participantId={participantId}
        total={myTotal}
        hostName={room.split.hostName}
        hasClaims={hasClaims}
      />

      <Toast message={toast} />
    </div>
  );
}
