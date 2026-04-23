"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger";

const base =
  "inline-flex items-center justify-center font-display text-2xl tracking-wide uppercase rounded-2xl px-6 h-14 select-none transition active:translate-y-[2px] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0 disabled:shadow-[0_4px_0_0_rgba(0,0,0,0.15)]";

const styles: Record<Variant, string> = {
  primary:
    "bg-ink text-white shadow-[0_4px_0_0_#000] hover:bg-black/90 active:shadow-[0_2px_0_0_#000]",
  ghost:
    "bg-white text-ink border border-black/10 shadow-[0_3px_0_0_rgba(0,0,0,0.06)]",
  danger:
    "bg-red text-white shadow-[0_4px_0_0_#a92e22]",
};

type CommonProps = {
  children: ReactNode;
  variant?: Variant;
  full?: boolean;
  className?: string;
};

export function Button({
  children,
  variant = "primary",
  full,
  className = "",
  ...rest
}: CommonProps & ComponentProps<"button">) {
  return (
    <button
      {...rest}
      className={`${base} ${styles[variant]} ${full ? "w-full" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  children,
  href,
  variant = "primary",
  full,
  className = "",
}: CommonProps & { href: string }) {
  return (
    <Link
      href={href}
      className={`${base} ${styles[variant]} ${full ? "w-full" : ""} ${className}`}
    >
      {children}
    </Link>
  );
}
