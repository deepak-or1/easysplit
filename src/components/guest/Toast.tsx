"use client";

/** Transient, auto-dismissing notice (the parent controls visibility & timing). */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <div
        role="status"
        className="animate-[var(--animate-pop)] max-w-sm rounded-full bg-ink px-4 py-2.5 text-center text-sm font-medium text-paper shadow-[var(--shadow-pop)]"
      >
        {message}
      </div>
    </div>
  );
}
