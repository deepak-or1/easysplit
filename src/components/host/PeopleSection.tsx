"use client";

import { useState } from "react";
import clsx from "clsx";
import type { PaidStatus, Participant, RoomState } from "@/lib/types";
import { markPaid, patchSplit } from "@/lib/api";
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
  const birthdayIds = room.participants.filter((p) => p.isBirthday).map((p) => p.id);
  // The settlement ignores the flags outright when nobody is left to pay —
  // say so rather than letting the host wonder why nothing changed.
  const everyoneFlagged =
    room.participants.length > 0 && birthdayIds.length === room.participants.length;

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
              birthdayIds={birthdayIds}
              splitId={splitId}
              hostKey={hostKey}
              applyState={applyState}
            />
          ))
        )}
      </Card>
      <p className="px-1 text-xs text-muted">
        🎂 marks a birthday — that person pays $0 and everyone else splits their share.
      </p>
      {everyoneFlagged && (
        <p className="rounded-xl bg-gold-soft px-4 py-2.5 text-xs text-[#6f5a00]">
          Everyone&apos;s flagged, so nobody is being covered — someone has to pay. Un-flag whoever
          isn&apos;t the birthday person.
        </p>
      )}
    </section>
  );
}

function PersonRow({
  participant,
  totalCents,
  birthdayIds,
  splitId,
  hostKey,
  applyState,
}: {
  participant: Participant;
  totalCents: number;
  /** Everyone currently flagged — the PATCH is a full replace, not a delta. */
  birthdayIds: string[];
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

  async function toggleBirthday() {
    setBusy(true);
    setErr(null);
    try {
      const next = participant.isBirthday
        ? birthdayIds.filter((id) => id !== participant.id)
        : [...birthdayIds, participant.id];
      applyState(await patchSplit(splitId, hostKey, { birthdayParticipantIds: next }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't update. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={participant.name} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">
              {participant.name}
              {participant.isBirthday && <span aria-hidden> 🎂</span>}
              {participant.isHost && (
                <span className="ml-1.5 text-xs font-normal text-muted">(you • host)</span>
              )}
            </p>
            {participant.isBirthday ? (
              <p className="text-sm text-success">
                <Money cents={totalCents} /> · covered by the table 🎂
              </p>
            ) : (
              <Money cents={totalCents} className="text-sm text-muted" />
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-pressed={participant.isBirthday}
            aria-label={
              participant.isBirthday
                ? `Clear ${participant.name}'s birthday`
                : `It's ${participant.name}'s birthday`
            }
            title={participant.isBirthday ? "Not their birthday after all" : "It's their birthday"}
            disabled={busy}
            onClick={() => void toggleBirthday()}
            className={clsx(
              "grid size-11 shrink-0 place-items-center rounded-full text-lg transition-all",
              "disabled:opacity-45",
              participant.isBirthday
                ? "bg-gold-soft ring-1 ring-gold"
                : "opacity-45 grayscale hover:bg-cream hover:opacity-100 hover:grayscale-0",
            )}
          >
            🎂
          </button>
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
    // Stacked, not inline: side by side the pair crushes the name column on
    // narrow screens (name wraps to one character per line).
    return (
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" variant="success" loading={busy} onClick={() => onSet("confirmed")}>
          Confirm
        </Button>
        <Badge tone="gold">says they paid</Badge>
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
