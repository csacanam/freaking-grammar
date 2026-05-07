"use client";

import Link from "next/link";
import { useLang } from "@/lib/lang-provider";

// Small "← Back" link for sub-pages (sponsor, refill, stats). Defaults
// to the Grammar lobby because that's where sponsor/refill flows still
// originate. Pages that span multiple games (like /stats now) pass
// `href` to override — usually `/` so the back arrow lands on the
// nerdos.fun picker instead of forcing the user back into Grammar.
export function BackLink({
  label = "Back",
  href,
}: {
  label?: string;
  href?: string;
}) {
  const { game } = useLang();
  const target = href ?? `/grammar?game=${game}`;
  return (
    <Link
      href={target}
      className="inline-flex items-center gap-1 text-xs font-display tracking-widest uppercase text-muted hover:text-ink"
    >
      ← {label}
    </Link>
  );
}
