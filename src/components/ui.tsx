"use client";

import clsx from "clsx";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { formatCents } from "@/lib/money";

/* Shared UI primitives. Every page composes from these so the app reads as
 * one product. Variants only — page-specific layout lives with the page. */

type ButtonVariant = "primary" | "secondary" | "ghost" | "venmo" | "success" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all",
        "active:scale-[0.97] disabled:opacity-45 disabled:pointer-events-none select-none",
        {
          sm: "px-3.5 py-1.5 text-sm",
          md: "px-5 py-2.5 text-[15px]",
          lg: "px-7 py-3.5 text-base w-full",
        }[size],
        {
          primary: "bg-primary text-white hover:bg-primary-deep shadow-[0_4px_14px_-4px_rgb(229_72_77/0.5)]",
          secondary: "bg-cream text-ink hover:bg-line/70 border border-line",
          ghost: "text-muted hover:text-ink hover:bg-cream",
          venmo: "bg-venmo text-white hover:bg-venmo-deep shadow-[0_4px_14px_-4px_rgb(0_140_255/0.5)]",
          success: "bg-success text-white hover:brightness-95",
          danger: "bg-danger-soft text-danger hover:brightness-95",
        }[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner className="size-4 border-current" />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={clsx("bg-card rounded-card shadow-card border border-line/60", className)}>
      {children}
    </div>
  );
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "w-full rounded-xl border border-line bg-card px-4 py-3 text-[15px] text-ink",
        "placeholder:text-muted/70 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20",
        className,
      )}
      {...rest}
    />
  );
}

export function Chip({
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={clsx(
        "rounded-full px-3.5 py-1.5 text-sm font-medium border transition-colors whitespace-nowrap",
        active
          ? "bg-ink text-paper border-ink"
          : "bg-card text-ink border-line hover:border-muted",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "inline-block size-5 animate-spin rounded-full border-2 border-line border-t-primary",
        className,
      )}
      aria-label="Loading"
    />
  );
}

export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={clsx("tabular", className)}>{formatCents(cents)}</span>;
}

export function ProgressBar({ ratio, className }: { ratio: number; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return (
    <div className={clsx("h-2.5 w-full overflow-hidden rounded-full bg-line/60", className)}>
      <div
        className={clsx(
          "h-full rounded-full transition-[width] duration-500",
          pct >= 100 ? "bg-success" : "bg-gold",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const AVATAR_COLORS = [
  "bg-[#E5484D]",
  "bg-[#1F9D62]",
  "bg-[#B0713F]",
  "bg-[#7A5CC4]",
  "bg-[#D8477A]",
  "bg-[#2E86AB]",
  "bg-[#C99017]",
  "bg-[#5B8C5A]",
];

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0",
        { sm: "size-6 text-[11px]", md: "size-8 text-sm", lg: "size-11 text-lg" }[size],
        color,
        className,
      )}
      title={name}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "success" | "gold" | "primary" | "danger";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        {
          neutral: "bg-cream text-muted",
          success: "bg-success-soft text-success",
          gold: "bg-gold-soft text-[#6f5a00]",
          primary: "bg-primary-soft text-primary-deep",
          danger: "bg-danger-soft text-danger",
        }[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  emoji,
  title,
  hint,
  action,
  className,
}: {
  emoji: string;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col items-center gap-2 py-10 text-center", className)}>
      <span className="text-4xl">{emoji}</span>
      <p className="font-display text-lg font-semibold">{title}</p>
      {hint && <p className="max-w-xs text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function CopyButton({
  text,
  label,
  copiedLabel = "Copied!",
  variant = "secondary",
  size = "md",
  className,
}: {
  text: string;
  label: string;
  copiedLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant={copied ? "success" : variant}
      size={size}
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Older mobile browsers: fall back to a prompt so the value is still reachable.
          window.prompt("Copy this:", text);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? copiedLabel : label}
    </Button>
  );
}

export function ErrorNote({ message, className }: { message: string; className?: string }) {
  return (
    <p className={clsx("rounded-xl bg-danger-soft px-4 py-2.5 text-sm text-danger", className)}>
      {message}
    </p>
  );
}
