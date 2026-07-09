import clsx from "clsx";
import type { ReactNode } from "react";

/** A soft gold note — used for the mock-OCR warning and QR-backup message.
 * Dismissible when onDismiss is provided. */
export function GoldNote({
  children,
  onDismiss,
  emoji = "💡",
  className,
}: {
  children: ReactNode;
  onDismiss?: () => void;
  emoji?: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex items-start gap-2.5 rounded-xl bg-gold-soft px-4 py-3 text-sm text-[#6f5a00]",
        className,
      )}
    >
      <span aria-hidden className="text-base leading-5">
        {emoji}
      </span>
      <div className="flex-1 leading-snug">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 shrink-0 rounded-full px-1.5 text-[#6f5a00]/60 hover:text-[#6f5a00]"
        >
          ✕
        </button>
      )}
    </div>
  );
}
