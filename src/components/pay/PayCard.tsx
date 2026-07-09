"use client";

import type { Split } from "@/lib/types";
import type { VenmoPayment } from "@/lib/venmo";
import { buildZelleLink, formatZelleHandle } from "@/lib/zelle";
import { Card, CopyButton } from "@/components/ui";

/**
 * The payment controls. Designed to work even when Venmo prefill doesn't:
 * copy-amount + copy-note are always first-class, the note is always visible,
 * and the host's QR is offered when present.
 */
/**
 * Open Venmo with the payment prefilled. On phones, the native deep link
 * (venmo://paycharge) is the only route that reliably lands on the app's
 * compose-payment screen with amount + note filled in — universal links to
 * venmo.com can open the app on the *profile* screen and drop the params.
 * If the app never takes over (not installed), fall back to the web pay page.
 */
function openVenmo(payment: VenmoPayment) {
  const { webUrl, deepLink } = payment;
  if (!webUrl) return;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!isMobile || !deepLink) {
    window.open(webUrl, "_blank", "noopener,noreferrer");
    return;
  }
  const fallback = window.setTimeout(() => {
    // Still visible after ~1.6s → the app didn't open; use the web pay page.
    if (!document.hidden) window.location.href = webUrl;
  }, 1600);
  const cancel = () => window.clearTimeout(fallback);
  window.addEventListener("pagehide", cancel, { once: true });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) cancel();
    },
    { once: true },
  );
  window.location.href = deepLink;
}

export function PayCard({ split, payment }: { split: Split; payment: VenmoPayment }) {
  const host = split.hostName;

  return (
    <Card className="space-y-4 p-5 animate-[var(--animate-rise)]">
      {payment.webUrl ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => openVenmo(payment)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-venmo px-7 py-3.5 text-base font-semibold text-white shadow-[0_4px_14px_-4px_rgb(0_140_255/0.5)] transition-all hover:bg-venmo-deep active:scale-[0.97]"
          >
            Pay {host} ${payment.amount} on Venmo
          </button>
          <p className="text-center text-xs text-muted">
            Amount and note should arrive prefilled — double-check, then confirm inside Venmo.
            We never touch your account.
          </p>
        </div>
      ) : !split.zelleHandle ? (
        <div className="rounded-xl bg-cream px-4 py-3 text-center text-sm text-muted">
          The host hasn&apos;t added a payment method yet — copy your amount and pay them your
          favorite way.
        </div>
      ) : null}

      {split.zelleHandle && (
        <div className="rounded-xl border border-line bg-cream/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            {payment.webUrl ? "Or pay with Zelle" : "Pay with Zelle"}
          </p>
          <p className="mt-1.5 text-sm text-ink">
            Send to{" "}
            <span className="font-semibold tabular">{formatZelleHandle(split.zelleHandle)}</span>{" "}
            ({split.hostName})
          </p>
          <div className="mt-3 flex gap-2">
            <a
              href={buildZelleLink(split.zelleHandle, split.hostName)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 items-center justify-center rounded-full bg-zelle px-5 py-2.5 text-[15px] font-semibold text-white transition-all hover:bg-zelle-deep active:scale-[0.97]"
            >
              Open Zelle
            </a>
            <CopyButton
              text={split.zelleHandle}
              label="Copy handle"
              copiedLabel="Copied!"
              className="flex-1"
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            Zelle can&apos;t prefill the amount — copy ${payment.amount} above and enter it in
            your banking app.
          </p>
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
