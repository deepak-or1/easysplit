import clsx from "clsx";

/**
 * The 🎂 that rides next to a birthday person's name. One component so the
 * mark reads identically in every list — receipt rows, pickers, chat, the
 * host's people list — and always carries a text label for screen readers.
 */
export function BirthdayMark({ name, className }: { name?: string; className?: string }) {
  return (
    <span
      className={clsx("shrink-0 text-sm leading-none", className)}
      title={name ? `It's ${name}'s birthday — the table's covering them` : "Birthday"}
    >
      <span aria-hidden>🎂</span>
      <span className="sr-only">{name ? ` ${name} has a birthday` : " birthday"}</span>
    </span>
  );
}
