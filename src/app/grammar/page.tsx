"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PotCard } from "@/components/PotCard";
import { Countdown } from "@/components/Countdown";
import { UnclaimedBanner } from "@/components/UnclaimedBanner";
import { ResumePaidBanner } from "@/components/ResumePaidBanner";
import { SakaLabsCredit } from "@/components/SakaLabsCredit";
import {
  getLobby,
  getOpenRuns,
  getUnclaimed,
  type LobbyData,
  type OpenRun,
  type UnclaimedWin,
} from "@/lib/api";
import { useCurrentPlayer } from "@/lib/wallet";
import { useLang } from "@/lib/lang-provider";
import type { Lang } from "@/lib/i18n";

const GAMES: Lang[] = ["en", "es"];

export default function LobbyPage() {
  const [lobbies, setLobbies] = useState<Record<Lang, LobbyData | null>>({
    en: null,
    es: null,
  });
  const [unclaimed, setUnclaimed] = useState<UnclaimedWin[]>([]);
  const [openRuns, setOpenRuns] = useState<OpenRun[]>([]);
  const { address } = useCurrentPlayer();
  const { t } = useLang();

  useEffect(() => {
    let alive = true;
    setLobbies({ en: null, es: null });
    setUnclaimed([]);
    setOpenRuns([]);

    Promise.all(GAMES.map((g) => getLobby(g, address || undefined))).then(
      (results) => {
        if (!alive) return;
        const next: Record<Lang, LobbyData | null> = { en: null, es: null };
        GAMES.forEach((g, i) => {
          next[g] = results[i];
        });
        setLobbies(next);
      },
    );

    if (address) {
      Promise.all([getUnclaimed("en", address), getUnclaimed("es", address)])
        .then(([en, es]) => {
          if (alive) setUnclaimed([...en, ...es]);
        });
      getOpenRuns(address).then((runs) => {
        if (alive) setOpenRuns(runs);
      });
    }

    return () => {
      alive = false;
    };
  }, [address]);

  const totalUnclaimed = unclaimed.reduce((s, w) => s + w.amountUSD, 0);

  // Both games close at the same 00:00 UTC moment; fall back to a locally
  // computed next midnight so the countdown shows something before the fetch.
  const resetIso = useMemo(() => {
    const fromLobby = lobbies.en?.closesAtIso ?? lobbies.es?.closesAtIso;
    if (fromLobby) return fromLobby;
    const d = new Date();
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1),
    ).toISOString();
  }, [lobbies]);

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      {/* Sticky brand header + today's-pots strip. Stays pinned so the user
          always knows what app they're in and how long until rollover, while
          the pot cards themselves scroll underneath. */}
      <div className="sticky top-0 z-20 bg-bg/90 backdrop-blur-md px-5 pt-5 pb-3 flex flex-col gap-3 border-b border-black/5">
        {/* Tiny "← nerdos.fun" link above the brand: lets the player jump
            back to the platform picker without going through the browser
            back button. Replaces the old SakaLabsCredit on this page —
            picker-bound surfaces feel more useful here than attribution. */}
        <Link
          href="/"
          className="self-start inline-flex items-center gap-1 text-[10px] font-display tracking-[0.25em] uppercase text-muted hover:text-ink"
        >
          <span aria-hidden>←</span>
          {t.backToPicker}
        </Link>
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Image src="/mascot.png" alt="" width={36} height={36} />
            <span className="font-display text-xl tracking-wider">
              {t.appName}
            </span>
          </div>
          <SakaLabsCredit />
        </header>

        <div className="flex items-center justify-between">
          <div className="font-display text-sm tracking-[0.25em] uppercase text-muted">
            {t.todaysPots}
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-display tracking-wider uppercase text-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse" />
            <span>{t.closesIn}</span>
            <Countdown
              targetIso={resetIso}
              className="font-mono tabular-nums text-ink"
            />
          </div>
        </div>
      </div>

      <div className="px-5 pt-4 pb-10 flex flex-col gap-4">
        <ResumePaidBanner runs={openRuns} />
        <UnclaimedBanner totalUSD={totalUnclaimed} />
        {GAMES.map((g) => (
          <PotCard key={g} game={g} lobby={lobbies[g]} />
        ))}
      </div>
    </div>
  );
}
