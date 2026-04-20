"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useLang } from "@/lib/lang-provider";
import { PlayerName } from "@/components/PlayerName";

type Row = { rank: number; player: string; score: number; isMe?: boolean };

const TOP = 3;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Leaderboard({
  rows,
  closesAtIso,
}: {
  rows: Row[];
  closesAtIso: string;
}) {
  const { t, game } = useLang();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const closed = now >= new Date(closesAtIso).getTime();
  const top = rows.slice(0, TOP);
  const me = rows.find((r) => r.isMe);
  const meOutside = me && me.rank > TOP;

  return (
    <div className="rounded-3xl bg-white border border-black/5 p-5 shadow-[0_4px_0_0_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-2xl">
          <span className="text-muted">{game.toUpperCase()}</span>
          <span className="text-muted mx-2">·</span>
          {closed ? t.finalStandings : t.todaysLeaderboard}
        </h2>
        {closed && (
          <span className="text-xs text-muted font-display tracking-wider uppercase">
            {formatDate(closesAtIso)}
          </span>
        )}
      </div>
      <ul className="divide-y divide-black/5">
        {top.map((r) => (
          <RowItem key={r.rank} r={r} showTrophy={closed && r.rank === 1} />
        ))}
        {top.length === 0 && (
          <li className="py-8 text-center text-muted text-sm">
            {t.noPlaysYet}
          </li>
        )}
        {meOutside && (
          <>
            <li className="py-2 text-center text-muted text-xs tracking-[0.4em] select-none">
              •••
            </li>
            <RowItem r={me} showTrophy={false} />
          </>
        )}
      </ul>
    </div>
  );
}

function RowItem({ r, showTrophy }: { r: Row; showTrophy: boolean }) {
  return (
    <li className={`flex items-center gap-3 py-3 ${r.isMe ? "font-semibold" : ""}`}>
      <span
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-display text-lg ${
          r.rank === 1
            ? "bg-yellow text-ink"
            : r.rank === 2
            ? "bg-purple/20 text-purple"
            : r.rank === 3
            ? "bg-orange/30 text-ink"
            : "bg-black/[0.04] text-muted"
        }`}
      >
        {showTrophy ? (
          <Image src="/medal.png" alt="winner" width={22} height={22} />
        ) : (
          r.rank
        )}
      </span>
      <span className="flex-1 text-sm text-ink truncate">
        <PlayerName address={r.player} />
        {r.isMe && (
          <span className="ml-2 text-xs text-teal font-display uppercase">you</span>
        )}
      </span>
      <span className="font-display text-xl tabular-nums">{r.score}</span>
    </li>
  );
}

