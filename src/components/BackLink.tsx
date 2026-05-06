"use client";

import Link from "next/link";
import { useLang } from "@/lib/lang-provider";

// Small "← Back" link for sub-pages (sponsor, refill, stats). Sends the
// user to the Grammar lobby — these surfaces are reached from inside the
// Grammar app today; when /math/* exists we'll thread through which app
// the user came from.
export function BackLink({ label = "Back" }: { label?: string }) {
  const { game } = useLang();
  return (
    <Link
      href={`/grammar?game=${game}`}
      className="inline-flex items-center gap-1 text-xs font-display tracking-widest uppercase text-muted hover:text-ink"
    >
      ← {label}
    </Link>
  );
}
