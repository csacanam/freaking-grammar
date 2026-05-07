"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Countdown } from "@/components/Countdown";
import { PayAndPlayButton } from "@/components/PayAndPlayButton";
import { PlayerName } from "@/components/PlayerName";
import { SakaLabsCredit } from "@/components/SakaLabsCredit";
import { fmtUSD } from "@/lib/format";
import { getMathLobby, type LobbyData } from "@/lib/api";
import { useCurrentPlayer } from "@/lib/wallet";
import { useLang } from "@/lib/lang-provider";

const TOP = 3;

// Math home. Single-game, no language toggle. Visually mirrors the
// Grammar PotCard (white card, accent stripe, tinted pot tag, mini
// leaderboard, play CTA, sponsor link) so the platform feels like one
// product family. Math's accent is orange — distinct from Grammar's
// teal/purple but related to the yellow used in the gameplay screen.
export default function MathLobbyPage() {
  const { t } = useLang();
  const { address } = useCurrentPlayer();
  const [lobby, setLobby] = useState<LobbyData | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await getMathLobby(address ?? undefined);
      if (alive) setLobby(data);
    })();
    return () => {
      alive = false;
    };
  }, [address]);

  const resetIso = useMemo(() => {
    const d = new Date();
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1),
    ).toISOString();
  }, []);

  const rows = lobby?.leaderboard ?? [];
  const top = rows.slice(0, TOP);
  const me = rows.find((r) => r.isMe);
  const meOutside = me && me.rank > TOP;

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      <div className="sticky top-0 z-20 bg-bg/90 backdrop-blur-md px-5 pt-5 pb-3 flex flex-col gap-3 border-b border-black/5">
        <Link
          href="/"
          className="self-start inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
        >
          <svg
            viewBox="0 0 16 16"
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M10 4l-4 4 4 4" />
          </svg>
          nerdos.fun
        </Link>
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔢</span>
            <span className="font-display text-xl tracking-wider">
              Freaking Math
            </span>
          </div>
          <SakaLabsCredit />
        </header>
      </div>

      <div className="px-5 pt-4 pb-10 flex flex-col gap-4">
        <div className="rounded-3xl bg-white border border-black/5 shadow-[0_6px_0_0_rgba(0,0,0,0.06)] flex flex-col overflow-hidden">
          <div className="h-1.5 bg-orange" />
          <div className="p-5 flex flex-col gap-4">
            {/* Pot title + countdown lives inside the card because Math
                has a single pot — the global "Today's pot · Closes in"
                strip Grammar uses above stacked EN/ES cards would be
                redundant context here. */}
            <div className="flex items-center justify-between -mt-1">
              <div className="font-display text-sm tracking-[0.25em] uppercase text-muted">
                {t.todaysPot}
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

            <div className="rounded-2xl bg-orange/10 px-4 py-3 flex items-baseline justify-between gap-3">
              <div className="font-display text-sm tracking-[0.15em] uppercase text-orange leading-tight">
                {t.winnerTakesAll}
              </div>
              <div className="font-display text-5xl text-ink leading-none tabular-nums">
                {lobby ? fmtUSD(lobby.potUSD) : "—"}
              </div>
            </div>

            <ul className="divide-y divide-black/5">
              {lobby === null && (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              )}
              {lobby && top.length === 0 && (
                <li className="py-5 text-center text-muted text-sm">
                  {t.noPlaysYet}
                </li>
              )}
              {lobby && top.map((r) => <Row key={r.rank} r={r} />)}
              {lobby && meOutside && (
                <>
                  <li className="py-1 text-center text-muted text-xs tracking-[0.4em] select-none">
                    •••
                  </li>
                  <Row r={me} />
                </>
              )}
            </ul>

            <PayAndPlayButton
              app="math"
              playerHasFreePlay={!!lobby?.playerHasFreePlay}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  r,
}: {
  r: { rank: number; player: string; score: number; isMe?: boolean };
}) {
  const { t } = useLang();
  return (
    <li
      className={`flex items-center gap-3 py-2.5 ${
        r.isMe ? "font-semibold" : ""
      }`}
    >
      <span
        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center font-display text-sm ${
          r.rank === 1
            ? "bg-yellow text-ink"
            : r.rank === 2
            ? "bg-purple/20 text-purple"
            : r.rank === 3
            ? "bg-orange/30 text-ink"
            : "bg-black/[0.04] text-muted"
        }`}
      >
        {r.rank === 1 ? (
          <Image src="/medal.png" alt="" width={16} height={16} />
        ) : (
          r.rank
        )}
      </span>
      <span className="flex-1 text-sm text-ink truncate">
        <PlayerName address={r.player} />
        {r.isMe && (
          <span className="ml-2 text-[10px] text-teal font-display tracking-widest uppercase">
            {t.youTag}
          </span>
        )}
      </span>
      <span className="font-display text-lg tabular-nums">{r.score}</span>
    </li>
  );
}

function SkeletonRow() {
  return <li className="h-10 bg-black/[0.04] animate-pulse rounded my-1.5" />;
}
