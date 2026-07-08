"use client";

import { useState, type FormEvent } from "react";
import { joinSplit, storeParticipantId } from "@/lib/api";
import type { Participant, Split } from "@/lib/types";
import { Button, Card, ErrorNote, Input } from "@/components/ui";

export function NameGate({
  split,
  splitId,
  onJoined,
}: {
  split: Split;
  splitId: string;
  onJoined: (p: Participant) => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const subtitle = split.restaurantName
    ? `${split.restaurantName} — hosted by ${split.hostName}`
    : `Hosted by ${split.hostName}`;

  async function join(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const p = await joinSplit(splitId, trimmed);
      storeParticipantId(splitId, p.id);
      onJoined(p);
      // onJoined swaps the view; leave loading true so the button stays busy through the transition.
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't join — try again.");
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md animate-[var(--animate-rise)] p-7 text-center">
      <p className="text-sm font-medium text-muted">{subtitle}</p>
      <h1 className="mt-3 font-display text-[2rem] font-semibold leading-tight text-ink">
        Everyone claims what they got.
      </h1>
      <p className="mt-2 text-[15px] text-muted">
        Add your first name to jump in — no account, no math.
      </p>

      <form onSubmit={join} className="mt-6 space-y-3 text-left">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your first name"
          autoFocus
          autoComplete="given-name"
          enterKeyHint="go"
          maxLength={40}
          aria-label="Your first name"
        />
        {err && <ErrorNote message={err} />}
        <Button type="submit" size="lg" loading={loading} disabled={!name.trim()}>
          Join the split
        </Button>
      </form>
    </Card>
  );
}
