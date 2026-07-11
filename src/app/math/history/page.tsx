"use client";

import { useEffect, useState } from "react";
import { fmtUSD } from "@/lib/format";
import { getMathHistory, type HistoryDay } from "@/lib/api";
import { useLang } from "@/lib/lang-provider";
import { useIsMiniPay } from "@/lib/minipay";
import { SakaLabsCredit } from "@/components/SakaLabsCredit";
import { PlayerName } from "@/components/PlayerName";

// Past Math pots, newest first. No EN/ES tag column because Math has
// a single global pot — every row is "Math". Mirrors the Grammar
// history visual rhythm so the platform feels consistent.
export default function MathHistoryPage() {
  const { t } = useLang();
  const inMiniPay = useIsMiniPay();
  const [days, setDays] = useState<HistoryDay[] | null>(null);

  useEffect(() => {
    getMathHistory().then(setDays);
  }, []);

  return (
    <div className="flex-1 flex flex-col px-5 pt-6 max-w-md mx-auto w-full gap-5">
      <header className="flex items-end justify-between">
        <h1 className="font-display text-3xl tracking-wider">{t.pastGames}</h1>
        <SakaLabsCredit />
      </header>

      <ul className="flex flex-col gap-3">
        {days === null && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}
        {days?.length === 0 && (
          <li className="rounded-2xl bg-white border border-dashed border-black/10 p-8 text-center text-muted text-sm">
            {t.noHistoryYet}
          </li>
        )}
        {days?.map((d) => (
          <li
            key={d.date}
            className="rounded-2xl bg-white border border-black/5 p-4 shadow-[0_3px_0_0_rgba(0,0,0,0.04)]"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-display tracking-widest uppercase text-muted flex items-center gap-2">
                  <span>{d.date}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-orange/20 text-orange">
                    MATH
                  </span>
                </div>
                <div className="font-display text-3xl mt-0.5">{fmtUSD(d.potUSD)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-display tracking-widest uppercase text-muted">
                  {t.winner}
                </div>
                {d.winner ? (
                  <>
                    <div className="text-sm truncate max-w-[10rem]">
                      <PlayerName address={d.winner} />
                    </div>
                    <div className="text-xs text-muted">
                      {t.score}: <span className="font-display">{d.winnerScore}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted italic">{t.noWinner}</div>
                )}
              </div>
            </div>
            {d.bonuses && d.bonuses.length > 0 && (
              <div className="mt-3 pt-3 border-t border-black/5 flex flex-col gap-1">
                {d.bonuses.map((b, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-muted font-display tracking-widest uppercase">
                      {b.emoji ? `${b.emoji} ` : ""}
                      {/* MiniPay: bonus stays, sponsor branding doesn't */}
                      {inMiniPay ? t.extraPrize : b.sponsor}
                    </span>
                    <span className="text-ink">
                      +{b.amount.toLocaleString()} {b.tokenSymbol}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkeletonCard() {
  return (
    <li className="rounded-2xl bg-white border border-black/5 p-4 h-24 animate-pulse" />
  );
}
