"use client";

import { useState } from "react";
import type { PaidStatus, Participant, RoomState } from "@/lib/types";
import { markPaid } from "@/lib/api";
import { Avatar, Badge, Button, Card, ErrorNote, Money } from "@/components/ui";

type ApplyState = (state: RoomState) => void;

interface Props {
  room: RoomState;
  splitId: string;
  hostKey: string;
  applyState: ApplyState;
}

export function PeopleSection({ room, splitId, hostKey, applyState }: Props) {
  const totalById = new Map(room.settlement.people.map((p) => [p.participantId, p.totalCents]));

  return (
    <section className="animate-[var(--animate-rise)] space-y-3">
      <h2 className="px-1 font-display text-xl font-semibold">People</h2>
      <Card className="divide-y divide-line/70">
        {room.participants.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">
            No one’s joined yet — share the link above.
          </p>
        ) : (
          room.participants.map((p) => (
            <PersonRow
              key={p.id}
              participant={p}
              totalCents={totalById.get(p.id) ?? 0}
              splitId={splitId}
              hostKey={hostKey}
              applyState={applyState}
            />
          ))
        )}
      </Card>
    </section>
  );
}

function PersonRow({
  participant,
  totalCents,
  splitId,
  hostKey,
  applyState,
}: {
  participant: Participant;
  totalCents: number;
  splitId: string;
  hostKey: string;
  applyState: ApplyState;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function setStatus(status: PaidStatus) {
    setBusy(true);
    setErr(null);
    try {
      const next = await markPaid(splitId, participant.id, status, hostKey);
      applyState(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't update. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={participant.name} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">
              {participant.name}
              {participant.isHost && (
                <span className="ml-1.5 text-xs font-normal text-muted">(you • host)</span>
              )}
            </p>
            <Money cents={totalCents} className="text-sm text-muted" />
          </div>
        </div>

        <div className="shrink-0">
          {participant.isHost ? null : (
            <PayAction status={participant.paidStatus} busy={busy} onSet={setStatus} />
          )}
        </div>
      </div>
      {err && <ErrorNote message={err} className="mt-2" />}
    </div>
  );
}

function PayAction({
  status,
  busy,
  onSet,
}: {
  status: PaidStatus;
  busy: boolean;
  onSet: (status: PaidStatus) => void;
}) {
  if (status === "confirmed") {
    return (
      <button
        type="button"
        onClick={() => onSet("unpaid")}
        disabled={busy}
        title="Tap to undo"
        className="disabled:opacity-50"
      >
        <Badge tone="success">Paid ✓</Badge>
      </button>
    );
  }

  if (status === "reported") {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="gold">says they paid</Badge>
        <Button size="sm" variant="success" loading={busy} onClick={() => onSet("confirmed")}>
          Confirm
        </Button>
      </div>
    );
  }

  // unpaid
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={() => onSet("confirmed")}>
      Mark paid
    </Button>
  );
}
