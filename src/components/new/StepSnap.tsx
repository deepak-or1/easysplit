"use client";

import { Button, Card, ErrorNote, Spinner } from "@/components/ui";

/** Step 1 — SNAP. Big friendly upload zone (camera on mobile) + a demo escape
 * hatch. The async parse itself is owned by the orchestrator; this step just
 * surfaces its loading / error states. */
export function StepSnap({
  onSelectFile,
  onUseDemo,
  loading,
  loadingLabel,
  error,
  onRetry,
  previewUrl,
}: {
  onSelectFile: (file: File) => void;
  onUseDemo: () => void;
  loading: boolean;
  loadingLabel: string;
  error: string | null;
  onRetry: () => void;
  previewUrl: string | null;
}) {
  return (
    <div className="flex flex-col gap-5 animate-[var(--animate-rise)]">
      <header className="text-center">
        <h1 className="font-display text-2xl font-semibold text-ink">Snap the receipt</h1>
        <p className="mt-1 text-sm text-muted">
          Take a photo or upload one — we&apos;ll read the items for you.
        </p>
      </header>

      {loading ? (
        <Card className="flex flex-col items-center gap-4 p-8 text-center">
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Your receipt"
              className="max-h-56 w-auto rounded-xl border border-line object-contain"
            />
          )}
          <div className="flex items-center gap-3 text-muted">
            <Spinner />
            <span className="text-sm font-medium">{loadingLabel}</span>
          </div>
        </Card>
      ) : (
        <>
          <label className="block cursor-pointer">
            {/* No `capture` attribute: with it, iOS jumps straight to the camera
                and hides the photo-library option. Without it, the native sheet
                offers Take Photo / Photo Library / Choose File. */}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onSelectFile(file);
                e.target.value = ""; // allow re-picking the same file
              }}
            />
            <Card className="flex flex-col items-center gap-3 border-dashed p-10 text-center transition-colors hover:border-primary hover:bg-cream/40">
              <span className="text-5xl" aria-hidden>
                📸
              </span>
              <span className="font-display text-lg font-semibold text-ink">
                Snap or upload the receipt
              </span>
              <span className="text-sm text-muted">Tap to use your camera or pick a photo</span>
            </Card>
          </label>

          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted/70">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>

          <Button variant="ghost" onClick={onUseDemo}>
            Use the demo receipt instead
          </Button>

          {error && (
            <div className="flex flex-col gap-2">
              <ErrorNote message={error} />
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
