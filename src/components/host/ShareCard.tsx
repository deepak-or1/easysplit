"use client";

import QRCode from "qrcode";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Card, CopyButton, Spinner } from "@/components/ui";

// window.location.origin is a read-once client value: the server snapshot ("")
// keeps hydration consistent, the client re-reads right after.
const noopSubscribe = () => () => {};

/**
 * The most important thing on the page: the room link + a scannable QR so
 * friends at the table can join with a camera, no app or account.
 */
export function ShareCard({ splitId }: { splitId: string }) {
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
  const link = origin ? `${origin}/split/${splitId}` : "";
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    QRCode.toDataURL(link, {
      width: 320,
      margin: 1,
      color: { dark: "#161615", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  return (
    <Card className="animate-[var(--animate-rise)] overflow-hidden p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">Share the room</h2>
      </div>
      <p className="mt-1 text-sm text-muted">Send this to the table — no app, no accounts.</p>

      <div className="mt-4 rounded-xl border border-line bg-cream px-4 py-3">
        <p className="break-all font-medium tabular text-ink">{link || " "}</p>
      </div>

      <div className="mt-3">
        <CopyButton text={link} label="Copy link" size="lg" variant="primary" />
      </div>

      <div className="mt-5 flex flex-col items-center gap-2">
        <div className="flex size-52 items-center justify-center rounded-2xl border border-line bg-card p-2">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- client-generated data URL
            <img src={qr} alt="QR code to join this split" className="size-full" />
          ) : qrFailed ? (
            <p className="px-4 text-center text-xs text-muted">
              Couldn’t render the QR — the link above still works.
            </p>
          ) : (
            <Spinner />
          )}
        </div>
        <p className="text-xs text-muted">Point a phone camera here to join.</p>
      </div>
    </Card>
  );
}
