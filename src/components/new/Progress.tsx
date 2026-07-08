import clsx from "clsx";

/** Four-dot progress indicator for the create wizard. `step` is 0-indexed. */
export function Progress({ step, total = 4 }: { step: number; total?: number }) {
  return (
    <div
      className="flex items-center gap-1.5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={step + 1}
      aria-label={`Step ${step + 1} of ${total}`}
    >
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={clsx(
            "h-2 rounded-full transition-all duration-300",
            i === step ? "w-6 bg-primary" : i < step ? "w-2 bg-primary/45" : "w-2 bg-line",
          )}
        />
      ))}
    </div>
  );
}
