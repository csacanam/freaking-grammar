"use client";

import Link from "next/link";
import { useLang } from "@/lib/lang-provider";

// Small "← Back" link for sub-pages (sponsor, refill, stats). Preserves the
// currently selected game via the `?game=` query param so returning to the
// Lobby lands the user on the same game they were viewing.
export function BackLink({ label = "Back" }: { label?: string }) {
  const { game } = useLang();
  return (
    <Link
      href={`/?game=${game}`}
      className="inline-flex items-center gap-1 text-xs font-display tracking-widest uppercase text-muted hover:text-ink"
    >
      ← {label}
    </Link>
  );
}
