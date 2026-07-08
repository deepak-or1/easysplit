import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A Next <Link> styled to match the shared <Button>. Used for real navigation
 * (landing CTAs, "go to dashboard") where an anchor — not a <button> — is
 * correct. Mirrors the Button variant/size classes so the app stays one system.
 */
type Variant = "primary" | "secondary" | "ghost" | "venmo";
type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, string> = {
  sm: "px-3.5 py-1.5 text-sm",
  md: "px-5 py-2.5 text-[15px]",
  lg: "px-7 py-3.5 text-base w-full",
};

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-deep shadow-[0_4px_14px_-4px_rgb(228_87_46/0.5)]",
  secondary: "bg-cream text-ink hover:bg-line/70 border border-line",
  ghost: "text-muted hover:text-ink hover:bg-cream",
  venmo: "bg-venmo text-white hover:bg-venmo-deep shadow-[0_4px_14px_-4px_rgb(0_140_255/0.5)]",
};

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all",
        "active:scale-[0.97] select-none",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}
