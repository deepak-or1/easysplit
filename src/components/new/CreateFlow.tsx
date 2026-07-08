"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSplit,
  demoReceipt,
  parseReceipt,
  storeHostKey,
  storeParticipantId,
  type CreateSplitResponse,
} from "@/lib/api";
import { centsToDollarString } from "@/lib/money";
import { Button } from "@/components/ui";
import { Progress } from "./Progress";
import { StepCheck } from "./StepCheck";
import { StepHost } from "./StepHost";
import { StepShare } from "./StepShare";
import { StepSnap } from "./StepSnap";
import {
  buildCreatePayload,
  emptyDraft,
  fileToDataUrl,
  itemsFromReceipt,
  payableItems,
  type Draft,
} from "./helpers";

type Step = 0 | 1 | 2 | 3; // SNAP, CHECK, HOST, SHARE

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

  const runParse = useCallback(
    async (kind: "file" | "demo", file?: File) => {
      setParseError(null);
      setParsing(true);
      try {
        let receiptImageDataUrl: string | null = null;
        if (kind === "demo") {
          setPreviewUrl(null);
        } else if (file) {
          const dataUrl = await fileToDataUrl(file);
          setPreviewUrl(dataUrl);
          receiptImageDataUrl = dataUrl;
        }
        const resp = kind === "demo" ? await demoReceipt() : await parseReceipt(receiptImageDataUrl!);
        const r = resp.receipt;
        setWarning(resp.warning ?? null);
        setDraft((d) => ({
          ...d,
          restaurantName: r.restaurantName ?? "",
          date: r.date ?? d.date,
          items: itemsFromReceipt(r),
          tax: r.taxCents ? centsToDollarString(r.taxCents) : "",
          ocrSubtotalCents: r.subtotalCents ?? null,
          receiptImageDataUrl,
        }));
        setStep(1);
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Couldn't read that receipt. Try again?");
      } finally {
        setParsing(false);
      }
    },
    [],
  );

  // ?demo=1 → jump straight to the demo receipt on mount.
  const demoFired = useRef(false);
  useEffect(() => {
    if (!demoFired.current && params.get("demo") === "1") {
      demoFired.current = true;
      void runParse("demo");
    }
  }, [params, runParse]);

  const submit = useCallback(async () => {
    setStep(3);
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createSplit(buildCreatePayload(draft));
      storeHostKey(res.splitId, res.hostKey);
      storeParticipantId(res.splitId, res.hostParticipantId);
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
  const canGoBack = (step === 1 || step === 2 || (step === 3 && !!createError && !creating)) && !result;
  const goBack = () => setStep((s) => (s > 0 ? ((s - 1) as Step) : s));

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
          <Progress step={step} />
          <div className="w-16" />
        </div>

        <div className="mt-7">
          {step === 0 && (
            <StepSnap
              onSelectFile={(file) => void runParse("file", file)}
              onUseDemo={() => void runParse("demo")}
              loading={parsing}
              loadingLabel="Reading the receipt…"
              error={parseError}
              onRetry={() => setParseError(null)}
              previewUrl={previewUrl}
            />
          )}
          {step === 1 && (
            <StepCheck
              draft={draft}
              patch={patch}
              warning={warning}
              onDismissWarning={() => setWarning(null)}
            />
          )}
          {step === 2 && <StepHost draft={draft} patch={patch} />}
          {step === 3 && (
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
      {(step === 1 || step === 2) && (
        <div className="sticky bottom-0 border-t border-line bg-paper/90 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-md">
            {step === 1 ? (
              <Button size="lg" onClick={() => setStep(2)} disabled={!canContinueCheck}>
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
