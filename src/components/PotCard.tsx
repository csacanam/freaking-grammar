"use client";

import Image from "next/image";
import Link from "next/link";
import { fmtUSD } from "@/lib/format";
import { PayAndPlayButton } from "@/components/PayAndPlayButton";
import { PlayerName } from "@/components/PlayerName";
import { useLang } from "@/lib/lang-provider";
import type { Lang } from "@/lib/i18n";
import type { LobbyData } from "@/lib/api";

const TOP = 3;

// Color identity per game — matches the split-screen palette inside the game
// (EN = left/teal, ES = right/purple). Same colors on the card as in the
// gameplay reinforces the association: "purple card → purple side in play".
const META: Record<
  Lang,
  {
    flag: string;
    label: string;
    stripe: string;
    tagBg: string;
    tagText: string;
    sponsorText: string;
  }
> = {
  en: {
    flag: "🇺🇸",
    label: "English",
    stripe: "bg-teal",
    tagBg: "bg-teal/10",
    tagText: "text-teal",
    sponsorText: "text-teal",
  },
  es: {
    flag: "🇪🇸",
    label: "Español",
    stripe: "bg-purple",
    tagBg: "bg-purple/10",
    tagText: "text-purple",
    sponsorText: "text-purple",
  },
};

// Self-contained pot venue: flag + pot amount + top-3 mini leaderboard +
// per-pot Play CTA + per-pot Sponsor link. Each card drives its own play
// flow for its own game, independent of whatever ?game= is in the URL.
export function PotCard({
  game,
  lobby,
}: {
  game: Lang;
  lobby: LobbyData | null;
}) {
  const { t } = useLang();
  const meta = META[game];

  const rows = lobby?.leaderboard ?? [];
  const top = rows.slice(0, TOP);
  const me = rows.find((r) => r.isMe);
  const meOutside = me && me.rank > TOP;

  return (
    <div className="rounded-3xl bg-white border border-black/5 shadow-[0_6px_0_0_rgba(0,0,0,0.06)] flex flex-col overflow-hidden">
      <div className={`h-1.5 ${meta.stripe}`} />
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl leading-none">{meta.flag}</span>
          <span className="font-display text-xl tracking-wider uppercase">
            {meta.label}
          </span>
        </div>

        <div
          className={`rounded-2xl ${meta.tagBg} px-4 py-3 flex items-baseline justify-between gap-3`}
        >
          <div
            className={`font-display text-sm tracking-[0.15em] uppercase ${meta.tagText} leading-tight`}
          >
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
        game={game}
        playerHasFreePlay={!!lobby?.playerHasFreePlay}
      />

        <Link
          href={`/sponsor?game=${game}`}
          className={`text-center text-xs font-display tracking-widest uppercase ${meta.sponsorText} hover:underline -mt-1`}
        >
          Sponsor this pot →
        </Link>
      </div>
    </div>
  );
}

function Row({
  r,
}: {
  r: { rank: number; player: string; score: number; isMe?: boolean };
}) {
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
            you
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
