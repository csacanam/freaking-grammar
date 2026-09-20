"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Countdown } from "@/components/Countdown";
import { PayAndPlayButton } from "@/components/PayAndPlayButton";
import { PlayerName } from "@/components/PlayerName";
import { SakaLabsCredit } from "@/components/SakaLabsCredit";
import { ResumePaidBanner } from "@/components/ResumePaidBanner";
import { UnclaimedBanner } from "@/components/UnclaimedBanner";
import { DrawAnnouncement } from "@/components/DrawAnnouncement";
import { ticketStepFor } from "@/lib/draw-config";
import { fmtUSD } from "@/lib/format";
import {
  getMathLobby,
  getOpenRuns,
  getUnclaimed,
  type LobbyData,
  type OpenRun,
  type UnclaimedWin,
} from "@/lib/api";
import { useCurrentPlayer } from "@/lib/wallet";
import { useLang } from "@/lib/lang-provider";

const TOP = 3;
const MATH_GAME_ID = 3; // matches the contract's gameId

// Math home. Single-game, no language toggle. Visually mirrors the
// Grammar PotCard (white card, accent stripe, tinted pot tag, mini
// leaderboard, play CTA, sponsor link) so the platform feels like one
// product family. Math's accent is orange — distinct from Grammar's
// teal/purple but related to the yellow used in the gameplay screen.
export default function MathLobbyPage() {
  const { t } = useLang();
  const { address } = useCurrentPlayer();
  const [lobby, setLobby] = useState<LobbyData | null>(null);
  const [openRuns, setOpenRuns] = useState<OpenRun[]>([]);
  const [unclaimed, setUnclaimed] = useState<UnclaimedWin[]>([]);

  useEffect(() => {
    let alive = true;
    setOpenRuns([]);
    setUnclaimed([]);
    (async () => {
      const data = await getMathLobby(address ?? undefined);
      if (alive) setLobby(data);
    })();
    if (address) {
      getOpenRuns(address).then((runs) => {
        if (alive) setOpenRuns(runs);
      });
      // Cross-game banner — surfaces ANY unclaimed win on this wallet,
      // including Grammar wins. The home for either game shows the
      // same total so a winner doesn't have to remember where they won.
      getUnclaimed(address).then((wins) => {
        if (alive) setUnclaimed(wins);
      });
    }
    return () => {
      alive = false;
    };
  }, [address]);

  const totalUnclaimed = unclaimed.reduce((s, w) => s + w.amountUSD, 0);

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
              {t.mathTitle}
            </span>
          </div>
          <SakaLabsCredit />
        </header>
      </div>

      <div className="px-5 pt-4 pb-10 flex flex-col gap-4">
        <ResumePaidBanner runs={openRuns} filter="math" />
        <UnclaimedBanner totalUSD={totalUnclaimed} />
        <DrawAnnouncement />
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

            <div className="rounded-2xl bg-orange/10 px-4 py-3 flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-display text-sm tracking-[0.15em] uppercase text-orange leading-tight">
                  {t.dailyDraw}
                </div>
                <div className="font-display text-5xl text-ink leading-none tabular-nums">
                  {lobby ? fmtUSD(lobby.potUSD) : "—"}
                </div>
              </div>
              {/* Honest odds line — same rules as the settlement draw. */}
              {lobby && (
                <div className="text-xs text-ink/60 leading-snug">
                  {(lobby.drawTicketsToday ?? 0) > 0 ? (
                    <>
                      🎟 {lobby.drawTicketsToday} {t.drawTicketsToday}
                      {(lobby.myTickets ?? 0) > 0 && (
                        <>
                          {" · "}
                          <span className="font-semibold text-ink/80">
                            {lobby.myTickets} {t.drawYours}
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <>🎟 {t.drawNoTickets}</>
                  )}
                </div>
              )}
              <div className="text-[11px] text-ink/40 leading-snug">
                {t.drawRule.replace("{n}", String(ticketStepFor(MATH_GAME_ID)))}
              </div>
            </div>

            <DrawEntrants lobby={lobby} />

            {/* The podium used to BE the prize; now it's status only. Saying
                so right above it prevents the misread ("#1 takes the pot"). */}
            <div className="text-[11px] text-ink/40 leading-snug">
              🏆 {t.leaderboardPrestige}
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

// Ticket holders sorted by tickets, separate from the glory board —
// mirrors the Grammar PotCard (see rationale there).
function DrawEntrants({ lobby }: { lobby: LobbyData | null }) {
  const { t } = useLang();
  if (!lobby) return null;
  const total = lobby.drawTicketsToday ?? 0;
  if (total <= 0) return null;
  const entrants = (lobby.leaderboard ?? [])
    .filter((r) => (r.tickets ?? 0) > 0)
    .sort((a, b) => (b.tickets ?? 0) - (a.tickets ?? 0) || b.score - a.score);
  if (entrants.length === 0) return null;
  return (
    <div className="flex flex-col">
      <div className="text-[11px] text-ink/40 leading-snug">
        🎟 {t.drawTodayTitle}
      </div>
      <ul className="divide-y divide-black/5">
        {entrants.map((e) => (
          <li
            key={e.player}
            className={`flex items-center gap-3 py-2 ${
              e.isMe ? "font-semibold" : ""
            }`}
          >
            <span className="flex-1 text-sm text-ink truncate">
              <PlayerName address={e.player} />
              {e.isMe && (
                <span className="ml-2 text-[10px] text-teal font-display tracking-widest uppercase">
                  {t.youTag}
                </span>
              )}
            </span>
            <span className="shrink-0 w-10 text-right text-[11px] text-muted tabular-nums">
              {Math.round((100 * (e.tickets ?? 0)) / total)}%
            </span>
            <span className="shrink-0 w-11 text-right">
              <span className="text-[11px] font-semibold text-teal bg-teal/10 rounded-full px-1.5 py-0.5 tabular-nums">
                🎟{e.tickets}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({
  r,
}: {
  r: {
    rank: number;
    player: string;
    score: number;
    tickets?: number;
    isMe?: boolean;
  };
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
