"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import {
  createSplit,
  demoReceipt,
  parseReceipt,
  recordRecentSplit,
  storeHostKey,
  storeParticipantId,
  type CreateSplitResponse,
} from "@/lib/api";
import { centsToDollarString } from "@/lib/money";
import type { SplitType } from "@/lib/types";
import { Button } from "@/components/ui";
import { Progress } from "./Progress";
import { StepCheck } from "./StepCheck";
import { StepHost } from "./StepHost";
import { StepKind } from "./StepKind";
import { StepShare } from "./StepShare";
import { StepSnap } from "./StepSnap";
import {
  buildCreatePayload,
  downscaleImageDataUrl,
  draftSplitName,
  emptyDraft,
  fileToDataUrl,
  itemsFromReceipt,
  payableItems,
  sharedByDefault,
  type Draft,
} from "./helpers";

type Step = 0 | 1 | 2 | 3 | 4; // KIND, SNAP, CHECK, HOST, SHARE
const STEP_COUNT = 5;

export function CreateFlow() {
  const params = useSearchParams();
  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  // Parse (step 1) state
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Create (step 4) state
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateSplitResponse | null>(null);

  const patch = useCallback((p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p })), []);

  // Resolves true when the receipt landed on the check step, false when the
  // parse failed — the caller decides where a failure should leave the host.
  const runParse = useCallback(
    // demoSplitType only matters for the demo: the sample receipt comes back in
    // the shape of the bill the host picked at step 0.
    async (
      kind: "file" | "demo",
      file?: File,
      demoSplitType: SplitType = "restaurant",
    ): Promise<boolean> => {
      setParseError(null);
      setParsing(true);
      try {
        let receiptImageDataUrl: string | null = null;
        if (kind === "demo") {
          setPreviewUrl(null);
        } else if (file) {
          // Downscale before upload: phone photos are 8–48MP; 2000px reads the
          // same for OCR at a fraction of the tokens and upload time.
          const dataUrl = await downscaleImageDataUrl(await fileToDataUrl(file));
          setPreviewUrl(dataUrl);
          receiptImageDataUrl = dataUrl;
        }
        const resp =
          kind === "demo"
            ? await demoReceipt(demoSplitType)
            : await parseReceipt(receiptImageDataUrl!);
        const r = resp.receipt;
        setWarning(resp.warning ?? null);
        setDraft((d) => {
          // A grocery run has no tip line to honour and starts fully shared —
          // the cart is the household's, not one person's order.
          const grocery = d.splitType === "grocery";
          const printedTip = !grocery && r.tipCents > 0 ? r.tipCents : null;
          // A whole-bill discount survives on a cart too — coupons are exactly
          // what a grocery run has.
          const printedDiscount = r.discountCents && r.discountCents > 0 ? r.discountCents : null;
          return {
            ...d,
            restaurantName: r.restaurantName ?? "",
            date: r.date ?? d.date,
            items: itemsFromReceipt(r, sharedByDefault(d.splitType)),
            tax: r.taxCents ? centsToDollarString(r.taxCents) : "",
            ocrSubtotalCents: r.subtotalCents ?? null,
            ocrTipCents: printedTip,
            ocrDiscountCents: printedDiscount,
            // A printed tip/service charge was already charged to the host — it
            // MUST be collected, so prefill it as a flat amount rather than
            // leaving the default 20% "gratuity choice" to overwrite it.
            ...(printedTip
              ? { tipMode: "amount" as const, tipFlat: centsToDollarString(printedTip) }
              : {}),
            // Same reasoning for a discount the receipt already applied: it's a
            // known dollar amount, not a percentage the host is choosing.
            ...(printedDiscount
              ? {
                  discountMode: "amount" as const,
                  discountFlat: centsToDollarString(printedDiscount),
                }
              : {}),
            receiptImageDataUrl,
          };
        });
        setStep(2);
        return true;
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Couldn't read that receipt. Try again?");
        return false;
      } finally {
        setParsing(false);
      }
    },
    [],
  );

  // ?demo=1 — the landing page's "Try it with a demo receipt". The host still
  // picks the split type first (the sample comes back in the shape they chose),
  // then advancing loads it straight onto the check step: no snap step, and no
  // parse on mount, so a browser-back into this page can't re-fire one.
  const demoMode = params.get("demo") === "1";
  const [skippedSnap, setSkippedSnap] = useState(false);

  const advanceFromKind = useCallback(async () => {
    if (!demoMode) {
      setStep(1);
      return;
    }
    const loaded = await runParse("demo", undefined, draft.splitType);
    // A failed demo parse drops the host on the snap step, where the retry and
    // upload affordances already live — never a dead end on the type choice.
    setSkippedSnap(loaded);
    if (!loaded) setStep(1);
  }, [demoMode, draft.splitType, runParse]);

  const submit = useCallback(async () => {
    setStep(4);
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createSplit(buildCreatePayload(draft));
      storeHostKey(res.splitId, res.hostKey);
      storeParticipantId(res.splitId, res.hostParticipantId);
      // The room is only ever findable by link — remember it so "Your splits"
      // on the home page can hand it back later.
      recordRecentSplit({
        splitId: res.splitId,
        name: draftSplitName(draft),
        role: "host",
        at: new Date().toISOString(),
      });
      setResult(res);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Couldn't create the split. Try again?");
    } finally {
      setCreating(false);
    }
  }, [draft]);

  const canContinueCheck = payableItems(draft.items).length >= 1;
  const canCreate = draft.hostName.trim().length >= 1;

  // Back is available on the editing steps, before a split is created.
  const canGoBack =
    (step === 1 || step === 2 || step === 3 || (step === 4 && !!createError && !creating)) &&
    !result;
  const goBack = () =>
    setStep((s) => {
      // The demo skipped the snap step on the way in, so skip it on the way out
      // too — "Back" from the check should return to the type choice, not to an
      // upload screen the host never saw.
      if (s === 2 && skippedSnap) return 0;
      return s > 0 ? ((s - 1) as Step) : s;
    });

  return (
    <main className="flex-1 w-full">
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-5">
        {/* Header: back / brand + progress */}
        <div className="flex h-9 items-center justify-between">
          <div className="w-16">
            {step === 0 ? (
              <Link href="/" className="text-sm text-muted hover:text-ink">
                ← Home
              </Link>
            ) : canGoBack ? (
              <button
                type="button"
                onClick={goBack}
                className="text-sm text-muted hover:text-ink"
              >
                ← Back
              </button>
            ) : null}
          </div>
          <Progress step={step} total={STEP_COUNT} />
          <div className="w-16" />
        </div>

        <div className="mt-7">
          {step === 0 && (
            <StepKind value={draft.splitType} onChange={(splitType) => patch({ splitType })} />
          )}
          {step === 1 && (
            <StepSnap
              onSelectFile={(file) => void runParse("file", file)}
              onUseDemo={() => void runParse("demo", undefined, draft.splitType)}
              loading={parsing}
              loadingLabel="Reading the receipt…"
              error={parseError}
              onRetry={() => setParseError(null)}
              previewUrl={previewUrl}
            />
          )}
          {step === 2 && (
            <StepCheck
              draft={draft}
              patch={patch}
              warning={warning}
              onDismissWarning={() => setWarning(null)}
            />
          )}
          {step === 3 && <StepHost draft={draft} patch={patch} />}
          {step === 4 && (
            <StepShare
              creating={creating}
              result={result}
              error={createError}
              onRetry={() => void submit()}
            />
          )}
        </div>
      </div>

      {/* Sticky primary action for the editing steps */}
      {(step === 0 || step === 2 || step === 3) && (
        <div className="sticky bottom-0 border-t border-line bg-paper/90 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-md">
            {step === 0 ? (
              <Button size="lg" onClick={() => void advanceFromKind()} loading={parsing}>
                {parsing
                  ? "Reading the receipt…"
                  : draft.splitType === "grocery"
                    ? "Split the groceries"
                    : "Split a restaurant bill"}
              </Button>
            ) : step === 2 ? (
              <Button size="lg" onClick={() => setStep(3)} disabled={!canContinueCheck}>
                Looks right — who&apos;s paying?
              </Button>
            ) : (
              <Button size="lg" onClick={() => void submit()} disabled={!canCreate}>
                Create the split
              </Button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
