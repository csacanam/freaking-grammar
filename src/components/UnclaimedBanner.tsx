"use client";

import Link from "next/link";
import { fmtUSD } from "@/lib/format";
import { useLang } from "@/lib/lang-provider";

export function UnclaimedBanner({ totalUSD }: { totalUSD: number }) {
  const { t } = useLang();
  if (totalUSD <= 0) return null;
  return (
    <Link
      href="/you"
      className="block rounded-2xl bg-yellow text-ink px-4 py-3 shadow-[0_3px_0_0_#c8b32f] active:translate-y-[2px] active:shadow-[0_1px_0_0_#c8b32f]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏆</span>
          <div>
            <div className="font-display tracking-wide leading-tight">{t.youHaveUnclaimed}</div>
            <div className="text-xs opacity-70">tap to claim</div>
          </div>
        </div>
        <div className="font-display text-2xl">{fmtUSD(totalUSD)}</div>
      </div>
    </Link>
  );
}
