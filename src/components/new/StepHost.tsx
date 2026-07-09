"use client";

import { useState } from "react";
import { Card, Chip, Input, Money, Spinner } from "@/components/ui";
import { dollarsToCents } from "@/lib/money";
import { parseVenmoInput } from "@/lib/venmo";
import { GoldNote } from "./GoldNote";
import { TotalsSummary } from "./TotalsSummary";
import {
  computeSubtotalCents,
  decodeQrFromDataUrl,
  fileToDataUrl,
  tipPreviewCents,
  type Draft,
} from "./helpers";

const TIP_PRESETS = [15, 18, 20, 25];

type QrStatus = "idle" | "decoding" | "decoded" | "backup";

/** Step 3 — HOST + TIP. Who's collecting, how much tip, and where friends pay. */
export function StepHost({
  draft,
  patch,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
}) {
  const [qrStatus, setQrStatus] = useState<QrStatus>(draft.venmoQrDataUrl ? "backup" : "idle");
  const liveHandle = parseVenmoInput(draft.venmoInput);
  const tipCents = tipPreviewCents(draft);

  async function handleQrFile(file: File) {
    setQrStatus("decoding");
    try {
      const dataUrl = await fileToDataUrl(file);
      const decoded = await decodeQrFromDataUrl(dataUrl);
      const username = decoded ? parseVenmoInput(decoded) : null;
      if (username) {
        patch({ venmoQrDataUrl: dataUrl, venmoInput: username, venmoUsername: username });
        setQrStatus("decoded");
      } else {
        // Keep the image anyway — friends can scan it directly.
        patch({ venmoQrDataUrl: dataUrl });
        setQrStatus("backup");
      }
    } catch {
      setQrStatus("idle");
    }
  }

  return (
    <div className="flex flex-col gap-6 animate-[var(--animate-rise)]">
      <header className="text-center">
        <h1 className="font-display text-2xl font-semibold text-ink">Who&apos;s collecting?</h1>
        <p className="mt-1 text-sm text-muted">
          Your name, the tip, and where friends send the money.
        </p>
      </header>

      {/* Host name */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Your first name</span>
        <Input
          value={draft.hostName}
          onChange={(e) => patch({ hostName: e.target.value })}
          placeholder="e.g. Deepak"
          autoComplete="given-name"
          maxLength={40}
        />
      </label>

      {/* Tip */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Tip</span>
          <div className="flex gap-1.5">
            <Chip active={draft.tipMode === "percent"} onClick={() => patch({ tipMode: "percent" })}>
              %
            </Chip>
            <Chip active={draft.tipMode === "amount"} onClick={() => patch({ tipMode: "amount" })}>
              Flat $
            </Chip>
          </div>
        </div>

        {draft.tipMode === "percent" ? (
          <div className="flex flex-wrap items-center gap-2">
            {TIP_PRESETS.map((pct) => (
              <Chip
                key={pct}
                active={draft.tipPercent === pct}
                onClick={() => patch({ tipPercent: pct })}
              >
                {pct}%
              </Chip>
            ))}
            <div className="relative w-24">
              <Input
                value={String(draft.tipPercent)}
                onChange={(e) => {
                  const n = parseInt(e.target.value.replace(/[^\d]/g, ""), 10);
                  patch({ tipPercent: Number.isFinite(n) ? Math.min(100, n) : 0 });
                }}
                inputMode="numeric"
                aria-label="Custom tip percent"
                className="pr-7 text-right tabular"
              />
              <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted">
                %
              </span>
            </div>
          </div>
        ) : (
          <div className="relative w-36">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
              $
            </span>
            <Input
              value={draft.tipFlat}
              onChange={(e) => patch({ tipFlat: e.target.value })}
              inputMode="decimal"
              placeholder="0.00"
              aria-label="Flat tip in dollars"
              className="pl-7 text-right tabular"
            />
          </div>
        )}

        {draft.ocrTipCents ? (
          <p className="rounded-xl bg-gold-soft px-3.5 py-2.5 text-xs text-[#6f5a00]">
            The receipt already includes a{" "}
            <Money cents={draft.ocrTipCents} className="font-semibold" /> tip / service charge —
            we&apos;ve prefilled it so the table pays it back. Bump the amount up if you tipped
            extra on top.
          </p>
        ) : null}
        <p className="text-xs text-muted">
          Tip so far: <Money cents={tipCents} className="text-ink" /> — split across the table by
          what everyone ordered.
        </p>

        <hr className="receipt-rule" />
        <TotalsSummary
          itemsCents={computeSubtotalCents(draft.items)}
          taxCents={dollarsToCents(draft.tax)}
          tipCents={tipCents}
        />
      </div>

      {/* Venmo */}
      <Card className="flex flex-col gap-3 p-4">
        <div>
          <p className="font-display text-base font-semibold text-ink">Venmo</p>
          <p className="text-xs text-muted">
            Optional — you can add it later, but friends pay faster when it&apos;s here.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Username</span>
          <Input
            value={draft.venmoInput}
            onChange={(e) => patch({ venmoInput: e.target.value })}
            onBlur={() => patch({ venmoUsername: parseVenmoInput(draft.venmoInput) })}
            placeholder="@your-handle"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {draft.venmoInput.trim() &&
            (liveHandle ? (
              <span className="text-xs font-medium text-success">Sends to @{liveHandle}</span>
            ) : (
              <span className="text-xs text-muted">
                Hmm, that doesn&apos;t look like a Venmo handle yet — or upload your QR below.
              </span>
            ))}
        </label>

        <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted/70">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleQrFile(file);
              e.target.value = "";
            }}
          />
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-sm transition-colors hover:border-primary hover:bg-cream/40">
            {qrStatus === "decoding" ? (
              <>
                <Spinner className="size-4" />
                <span className="text-muted">Reading your QR…</span>
              </>
            ) : draft.venmoQrDataUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={draft.venmoQrDataUrl}
                  alt="Your Venmo QR"
                  className="size-12 rounded-lg border border-line object-cover"
                />
                <span className="text-muted">
                  {qrStatus === "decoded" ? "QR scanned ✓" : "QR saved"} · tap to replace
                </span>
              </>
            ) : (
              <>
                <span className="text-lg" aria-hidden>
                  🔳
                </span>
                <span className="text-muted">Upload your Venmo QR</span>
              </>
            )}
          </div>
        </label>

        {qrStatus === "backup" && (
          <GoldNote emoji="🔳">
            We couldn&apos;t read that QR, but we&apos;ll show the image to your friends as a
            backup.
          </GoldNote>
        )}
      </Card>
    </div>
  );
}
