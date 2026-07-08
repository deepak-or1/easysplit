"use client";

import { useSyncExternalStore } from "react";
import type { CreateSplitResponse } from "@/lib/api";
import { Button, Card, CopyButton, ErrorNote, Spinner } from "@/components/ui";
import { LinkButton } from "./LinkButton";

// window.location.origin is a read-once client value: the server snapshot ("")
// keeps hydration consistent, the client re-reads right after.
const noopSubscribe = () => () => {};

/** Step 4 — SHARE. Fires create in the orchestrator; this renders the three
 * outcomes: creating (spinner), success (celebration + link), error (+ retry). */
export function StepShare({
  creating,
  result,
  error,
  onRetry,
}: {
  creating: boolean;
  result: CreateSplitResponse | null;
  error: string | null;
  onRetry: () => void;
}) {
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );

  if (creating) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center animate-[var(--animate-rise)]">
        <Spinner className="size-8" />
        <p className="font-display text-lg font-semibold text-ink">Setting up your split…</p>
        <p className="text-sm text-muted">One sec while we make your room.</p>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="flex flex-col gap-4 py-8 animate-[var(--animate-rise)]">
        <ErrorNote message={error ?? "Something went wrong creating your split."} />
        <Button onClick={onRetry}>Try again</Button>
      </div>
    );
  }

  const roomUrl = origin ? `${origin}${result.url}` : result.url;

  return (
    <div className="flex flex-col gap-5 animate-[var(--animate-pop)]">
      <header className="text-center">
        <span className="text-5xl" aria-hidden>
          🎉
        </span>
        <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Your split is live</h1>
        <p className="mt-1 text-sm text-muted">
          Send this link to the table — everyone claims what they got.
        </p>
      </header>

      <Card className="flex flex-col gap-3 p-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Room link</span>
        <p className="break-all rounded-xl bg-cream px-4 py-3 text-center font-display text-base font-semibold text-ink">
          {roomUrl}
        </p>
        <CopyButton text={roomUrl} label="Copy the link" size="lg" />
      </Card>

      <div className="flex flex-col gap-2">
        <LinkButton href={`${result.url}/host`} size="lg">
          Go to your dashboard
        </LinkButton>
        <LinkButton href={result.url} variant="ghost" size="lg">
          Preview the guest view
        </LinkButton>
      </div>
    </div>
  );
}
