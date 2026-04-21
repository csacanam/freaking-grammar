"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PotHeader } from "@/components/PotHeader";
import { Leaderboard } from "@/components/Leaderboard";
import { UnclaimedBanner } from "@/components/UnclaimedBanner";
import { PayAndPlayButton } from "@/components/PayAndPlayButton";
import { SakaLabsCredit } from "@/components/SakaLabsCredit";
import { getLobby, getUnclaimed, type LobbyData, type UnclaimedWin } from "@/lib/api";
import { useCurrentPlayer } from "@/lib/wallet";
import { useLang } from "@/lib/lang-provider";

export default function LobbyPage() {
  const [lobby, setLobby] = useState<LobbyData | null>(null);
  const [unclaimed, setUnclaimed] = useState<UnclaimedWin[]>([]);
  const { address } = useCurrentPlayer();
  const { t, game } = useLang();

  useEffect(() => {
    let alive = true;
    // Reset state so the UI shows loading (not stale data from the previous
    // game/address) while the new fetch is in flight.
    setLobby(null);
    setUnclaimed([]);
    // Lobby (pot + leaderboard) is public — fetch even without a wallet so
    // visitors can see what's going on. Unclaimed wins come from BOTH games
    // so the banner reflects everything the player can claim, not just the
    // currently selected language.
    Promise.all([
      getLobby(game, address || undefined),
      address
        ? Promise.all([getUnclaimed("en", address), getUnclaimed("es", address)])
        : Promise.resolve([[], []] as UnclaimedWin[][]),
    ]).then(([l, uByLang]) => {
      if (alive) {
        setLobby(l);
        setUnclaimed([...uByLang[0], ...uByLang[1]]);
      }
    });
    return () => {
      alive = false;
    };
  }, [address, game]);

  const totalUnclaimed = unclaimed.reduce((s, w) => s + w.amountUSD, 0);

  return (
    <div className="flex-1 flex flex-col px-5 pt-6 pb-32 max-w-md mx-auto w-full gap-5">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Image src="/mascot.png" alt="" width={36} height={36} />
          <span className="font-display text-xl tracking-wider">{t.appName}</span>
        </div>
        <SakaLabsCredit />
      </header>

      <UnclaimedBanner totalUSD={totalUnclaimed} />

      {lobby ? (
        <PotHeader closesAtIso={lobby.closesAtIso} />
      ) : (
        <div className="rounded-3xl bg-teal/40 h-56 animate-pulse" />
      )}

      <Link
        href="/sponsor"
        className="-mt-2 text-center text-sm font-display tracking-widest uppercase text-teal hover:underline"
      >
        Sponsor today&apos;s pot →
      </Link>

      <div className="flex-1">
        {lobby ? (
          <Leaderboard rows={lobby.leaderboard} closesAtIso={lobby.closesAtIso} />
        ) : (
          <div className="rounded-3xl bg-black/5 h-72 animate-pulse" />
        )}
      </div>

      <div className="fixed inset-x-0 bottom-20 z-30 pointer-events-none pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-md mx-auto px-5 pointer-events-auto">
          <PayAndPlayButton playerHasFreePlay={!!lobby?.playerHasFreePlay} />
        </div>
      </div>
    </div>
  );
}
