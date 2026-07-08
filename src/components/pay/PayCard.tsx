"use client";

import type { Split } from "@/lib/types";
import type { VenmoPayment } from "@/lib/venmo";
import { Card, CopyButton } from "@/components/ui";

/**
 * The payment controls. Designed to work even when Venmo prefill doesn't:
 * copy-amount + copy-note are always first-class, the note is always visible,
 * and the host's QR is offered when present.
 */
export function PayCard({ split, payment }: { split: Split; payment: VenmoPayment }) {
  const host = split.hostName;

  return (
    <Card className="space-y-4 p-5 animate-[var(--animate-rise)]">
      {payment.webUrl ? (
        <div className="space-y-2">
          <a
            href={payment.webUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-venmo px-7 py-3.5 text-base font-semibold text-white shadow-[0_4px_14px_-4px_rgb(0_140_255/0.5)] transition-all hover:bg-venmo-deep active:scale-[0.97]"
          >
            Pay {host} ${payment.amount} on Venmo
          </a>
          <p className="text-center text-xs text-muted">
            You&apos;ll confirm inside Venmo — we never touch your account.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-cream px-4 py-3 text-center text-sm text-muted">
          The host hasn&apos;t added their Venmo yet — copy your amount and pay them your favorite way.
        </div>
      )}

      {/* Always first-class, link or no link. */}
      <div className="flex gap-2">
        <CopyButton
          text={payment.amount}
          label={`Copy $${payment.amount}`}
          copiedLabel="Amount copied"
          className="flex-1"
        />
        <CopyButton
          text={payment.note}
          label="Copy note"
          copiedLabel="Note copied"
          className="flex-1"
        />
      </div>

      <div>
        <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-muted">Note</p>
        <p className="break-words rounded-xl bg-cream px-4 py-3 text-sm text-ink">{payment.note}</p>
      </div>

      {payment.username && (
        <p className="text-center text-sm text-muted">
          Venmo <span className="font-semibold text-ink">@{payment.username}</span>
        </p>
      )}

      {split.venmoQrUrl && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-cream/50 px-4 py-4">
          <p className="text-sm text-muted">Or scan the host&apos;s Venmo code</p>
          <div className="rounded-2xl border border-line bg-card p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- host-uploaded QR served via /api/files */}
            <img src={split.venmoQrUrl} alt={`${host}'s Venmo QR code`} className="size-40" />
          </div>
        </div>
      )}
    </Card>
  );
}
