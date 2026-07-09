import clsx from "clsx";

/**
 * The EasySplit mark: a persimmon receipt stub with a zigzag tear — the same
 * motif as the in-app receipt cards. Keep it simple; it has to read at 16px.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={clsx("size-8", className)}
      aria-hidden
    >
      <path
        d="M6 6a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v21.2l-3.33-2.2-3.34 2.2-3.33-2.2-3.33 2.2-3.34-2.2L6 27.2V6Z"
        fill="#E5484D"
      />
      <rect x="10" y="9" width="12" height="2.2" rx="1.1" fill="#FFFFFF" opacity="0.95" />
      <rect x="10" y="14" width="8.5" height="2.2" rx="1.1" fill="#FFFFFF" opacity="0.95" />
      <rect x="10" y="19" width="5" height="2.2" rx="1.1" fill="#FFFFFF" opacity="0.95" />
      <circle cx="20.8" cy="20.1" r="1.7" fill="#FFD84D" />
    </svg>
  );
}

export function Logo({
  className,
  markClassName,
  wordClassName,
}: {
  className?: string;
  markClassName?: string;
  wordClassName?: string;
}) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <LogoMark className={markClassName} />
      <span
        className={clsx(
          "font-display text-xl font-semibold tracking-tight text-ink",
          wordClassName,
        )}
      >
        EasySplit
      </span>
    </span>
  );
}
