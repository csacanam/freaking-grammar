"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Countdown } from "@/components/Countdown";
import { Button } from "@/components/Button";
import { Leaderboard } from "@/components/Leaderboard";
import { PayAndPlayButton } from "@/components/PayAndPlayButton";
import { SakaLabsCredit } from "@/components/SakaLabsCredit";
import { getMathLobby, type LobbyData } from "@/lib/api";
import { useCurrentPlayer } from "@/lib/wallet";

// Math lobby. Single-game, no language toggle. Shows today's pot,
// leaderboard, and the pay-and-play button (Math variant). Borrows the
// header chrome from /grammar but drops the EN/ES PotCard split — Math
// has one pot for everyone.
export default function MathLobbyPage() {
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

        <div className="flex items-center justify-between">
          <div className="font-display text-sm tracking-[0.25em] uppercase text-muted">
            Today&apos;s pot
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-display tracking-wider uppercase text-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse" />
            <span>Closes in</span>
            <Countdown
              targetIso={resetIso}
              className="font-mono tabular-nums text-ink"
            />
          </div>
        </div>
      </div>

      <div className="px-5 pt-4 pb-10 flex flex-col gap-4">
        {/* Pot card */}
        <div className="rounded-3xl bg-yellow/30 px-5 py-5 border border-black/5">
          <div className="flex items-baseline justify-between">
            <div className="font-display text-xs tracking-[0.25em] uppercase text-muted">
              Pot
            </div>
            <div className="font-display text-3xl tabular-nums">
              ${lobby ? lobby.potUSD.toFixed(2) : "—"}
            </div>
          </div>
          <p className="text-xs text-muted mt-2 leading-snug">
            Decide whether the math operation is correct or incorrect before
            time runs out. Longest streak today wins the pot in USDT.
          </p>
        </div>

        <PayAndPlayButton
          playerHasFreePlay={lobby?.playerHasFreePlay ?? true}
          app="math"
        />

        {lobby && lobby.leaderboard.length > 0 && (
          <div className="rounded-3xl bg-white px-5 py-4 border border-black/5">
            <div className="font-display text-xs tracking-[0.25em] uppercase text-muted mb-3">
              Today&apos;s leaderboard
            </div>
            <Leaderboard
              rows={lobby.leaderboard.slice(0, 10)}
              closesAtIso={lobby.closesAtIso}
            />
          </div>
        )}

        {lobby && lobby.leaderboard.length === 0 && (
          <div className="rounded-3xl bg-white px-5 py-6 border border-dashed border-black/10 text-center text-sm text-muted">
            No plays yet today — be the first.
          </div>
        )}
      </div>
    </div>
  );
}
