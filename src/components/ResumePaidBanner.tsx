"use client";

import Link from "next/link";
import type { OpenRun } from "@/lib/api";
import { useLang } from "@/lib/lang-provider";
import { tpl } from "@/lib/i18n";

// Shown on Home when the connected wallet has paid plays today that never
// finished a run (usually from a client-side failure between payment and
// startRun). One tap takes them to /game with the original txHash — the
// idempotent /api/runs endpoint finishes what was interrupted.
export function ResumePaidBanner({ runs }: { runs: OpenRun[] }) {
  const { t } = useLang();
  if (runs.length === 0) return null;
  const head = runs[0];
  const more = runs.length - 1;

  return (
    <Link
      href={`/game?tx=${head.txHash}&game=${head.lang}`}
      className="block rounded-2xl bg-teal text-white px-4 py-3 shadow-[0_4px_0_0_rgba(0,0,0,0.1)] active:translate-y-[2px] active:shadow-[0_2px_0_0_rgba(0,0,0,0.1)]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎮</span>
          <div>
            <div className="font-display tracking-wide leading-tight">
              {runs.length === 1
                ? t.resumeOne
                : tpl(t.resumeMany, { n: runs.length })}
            </div>
            <div className="text-xs opacity-80">
              {head.lang.toUpperCase()} · {t.resumeTapHint}
              {more > 0 && ` · ${tpl(t.resumeMoreAfter, { n: more })}`}
            </div>
          </div>
        </div>
        <span className="font-display text-xs tracking-widest uppercase">
          {t.resume}
        </span>
      </div>
    </Link>
  );
}
