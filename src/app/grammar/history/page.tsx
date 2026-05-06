"use client";

import { useEffect, useState } from "react";
import { fmtUSD } from "@/lib/format";
import { getHistory, type HistoryDay } from "@/lib/api";
import { useLang } from "@/lib/lang-provider";
import { type Lang } from "@/lib/i18n";
import { SakaLabsCredit } from "@/components/SakaLabsCredit";
import { PlayerName } from "@/components/PlayerName";

const LANGS: Lang[] = ["en", "es"];

type TaggedDay = HistoryDay & { lang: Lang };

export default function HistoryPage() {
  const { t } = useLang();
  const [days, setDays] = useState<TaggedDay[] | null>(null);

  useEffect(() => {
    // Pull both games so users see the full timeline regardless of which game
    // is currently selected. Each row is tagged with an EN/ES badge.
    Promise.all(LANGS.map((l) => getHistory(l))).then((results) => {
      const merged = results.flatMap((r, i) =>
        r.map((d) => ({ ...d, lang: LANGS[i] })),
      );
      merged.sort((a, b) => b.date.localeCompare(a.date));
      setDays(merged);
    });
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
            key={`${d.lang}-${d.date}`}
            className="rounded-2xl bg-white border border-black/5 p-4 shadow-[0_3px_0_0_rgba(0,0,0,0.04)]"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-display tracking-widest uppercase text-muted flex items-center gap-2">
                  <span>{d.date}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      d.lang === "en"
                        ? "bg-teal/20 text-teal"
                        : "bg-purple/20 text-purple"
                    }`}
                  >
                    {d.lang.toUpperCase()}
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
                      {b.sponsor}
                    </span>
                    <span className="text-ink font-sans">
                      <span className="font-bold tabular-nums">
                        +{b.amount.toLocaleString()}
                      </span>{" "}
                      <span className="font-semibold">
                        {b.tokenSymbol}
                      </span>
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
  return <div className="h-20 rounded-2xl bg-black/5 animate-pulse" />;
}
