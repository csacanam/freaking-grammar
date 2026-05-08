"use client";

import Link from "next/link";
import type { OpenRun } from "@/lib/api";
import { useLang } from "@/lib/lang-provider";
import { tpl } from "@/lib/i18n";

// Shown on the home of either game when the connected wallet has plays
// today (paid OR free) that never finished a run — typically from a
// client-side failure between payment and startRun, or a tab close
// during the briefing. One tap takes them back to the right game with
// the original txHash; the idempotent start-run endpoint serves the
// same first question instead of charging again. The contract burns
// the turn either way (lastFreePlayDay flips even on free plays), so
// recovery matters for both buckets.
//
// Optionally `filter` narrows to a single game so each home only shows
// its own resumables — the Grammar lobby shouldn't surface a Math run
// the wallet started moments ago, and vice versa.
export function ResumePaidBanner({
  runs,
  filter,
}: {
  runs: OpenRun[];
  filter?: "grammar" | "math";
}) {
  const { t } = useLang();
  const visible = filter ? runs.filter((r) => r.game === filter) : runs;
  if (visible.length === 0) return null;
  const head = visible[0];
  const more = visible.length - 1;

  // Math has no language split, so its game URL doesn't take a `game`
  // query param. Grammar still does because EN/ES live behind the same
  // /grammar/game route.
  const href =
    head.game === "math"
      ? `/math/game?tx=${head.txHash}`
      : `/grammar/game?tx=${head.txHash}&game=${head.lang}`;

  // Bucket label shown under the headline. Grammar reuses the lang code
  // ("EN"/"ES"); Math reads as "MATH" since it has no language to show.
  const bucketLabel = head.game === "math" ? "MATH" : (head.lang ?? "").toUpperCase();

  return (
    <Link
      href={href}
      className="block rounded-2xl bg-teal text-white px-4 py-3 shadow-[0_4px_0_0_rgba(0,0,0,0.1)] active:translate-y-[2px] active:shadow-[0_2px_0_0_rgba(0,0,0,0.1)]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎮</span>
          <div>
            <div className="font-display tracking-wide leading-tight">
              {visible.length === 1
                ? t.resumeOne
                : tpl(t.resumeMany, { n: visible.length })}
            </div>
            <div className="text-xs opacity-80">
              {bucketLabel} · {t.resumeTapHint}
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
