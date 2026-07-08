"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { markPaid } from "@/lib/api";
import { useRoom } from "@/lib/use-room";
import { buildVenmoPayment } from "@/lib/venmo";
import { Badge, Button, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { PayCard } from "./PayCard";
import { TotalCard } from "./TotalCard";

/** A room load error whose message reads like "not found" is a bad/expired link. */
function looksMissing(message: string): boolean {
  return /not.?found|doesn'?t exist|no such|unknown|expired|404/i.test(message);
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">{children}</div>
  );
}

export function PayPage({ splitId, personId }: { splitId: string; personId: string }) {
  const { room, error, isLoading, mutate } = useRoom(splitId);
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);

  const reportPaid = useCallback(async () => {
    setPaying(true);
    setPayErr(null);
    try {
      const next = await markPaid(splitId, personId, "reported");
      await mutate(next, { revalidate: false });
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : "Couldn't reach the host — try again.");
    } finally {
      setPaying(false);
    }
  }, [splitId, personId, mutate]);

  const roomHref = `/split/${splitId}`;

  // ---- Loading & error gates ----
  if (isLoading && !room) {
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
            emoji="🧾"
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

  const { split } = room;
  const person = room.participants.find((p) => p.id === personId);

  // ---- Identity gates ----
  if (!person) {
    return (
      <Screen>
        <EmptyState
          emoji="🤔"
          title="This link doesn't match anyone in the split"
          hint="It may be an old link. Open the room and tap your name to get your pay link."
          action={
            <Link href={roomHref}>
              <Button variant="secondary">Open the room</Button>
            </Link>
          }
        />
      </Screen>
    );
  }

  if (person.isHost) {
    return (
      <Screen>
        <EmptyState
          emoji="👑"
          title="You're the host — the table pays you"
          hint="Track who's paid and confirm payments from your dashboard."
          action={
            <Link href={`/split/${splitId}/host`}>
              <Button>Go to your dashboard</Button>
            </Link>
          }
        />
      </Screen>
    );
  }

  const ps = room.settlement.people.find((p) => p.participantId === personId);

  if (!ps || ps.totalCents <= 0) {
    return (
      <Screen>
        <EmptyState
          emoji="🍽️"
          title="You haven't claimed anything yet"
          hint="Head back to the room and grab what you had — then come back to settle up."
          action={
            <Link href={roomHref}>
              <Button>Back to the room</Button>
            </Link>
          }
        />
      </Screen>
    );
  }

  // ---- Normal pay flow ----
  const payment = buildVenmoPayment(split, ps);
  const status = person.paidStatus;
  const settled = status === "confirmed";

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto w-full max-w-md flex-1 space-y-5 px-4 pt-8 pb-4">
        <header className="text-center animate-[var(--animate-rise)]">
          <p className="text-sm text-muted">You&apos;re settling</p>
          <h1 className="font-display text-3xl font-semibold leading-tight text-ink">
            {split.restaurantName ?? "Dinner"}
          </h1>
          <p className="mt-1 text-sm text-muted">hosted by {split.hostName}</p>
        </header>

        <TotalCard ps={ps} settled={settled} />

        {settled ? (
          <Card className="space-y-1.5 border-success/25 bg-success-soft p-7 text-center animate-[var(--animate-pop)]">
            <p className="text-5xl">🎉</p>
            <p className="font-display text-2xl font-semibold text-success">You&apos;re settled</p>
            <p className="text-sm text-success/90">
              {split.hostName} confirmed your payment. Thanks for making it easy.
            </p>
          </Card>
        ) : (
          <>
            <PayCard split={split} payment={payment} />

            <section className="space-y-2">
              {status === "reported" ? (
                <div className="space-y-1.5 rounded-card bg-gold-soft px-5 py-4 text-center">
                  <Badge tone="gold">Payment reported</Badge>
                  <p className="font-display text-lg font-semibold text-ink">
                    Nice — we told {split.hostName} you paid.
                  </p>
                  <p className="text-sm text-muted">
                    They&apos;ll confirm it on their end. Need to resend? Your Venmo details are right
                    above.
                  </p>
                </div>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    size="lg"
                    loading={paying}
                    onClick={() => void reportPaid()}
                  >
                    I&apos;ve paid ✓
                  </Button>
                  <p className="text-center text-xs text-muted">
                    Tap once you&apos;ve sent it — {split.hostName} gets a heads-up.
                  </p>
                </>
              )}
              {payErr && <ErrorNote message={payErr} />}
            </section>
          </>
        )}
      </main>

      <footer className="mx-auto w-full max-w-md px-4 pt-2 pb-8 text-center">
        <Link
          href={roomHref}
          className="text-sm text-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
        >
          ← Back to the room
        </Link>
      </footer>
    </div>
  );
}
