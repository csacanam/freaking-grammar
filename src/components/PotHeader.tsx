"use client";

import Image from "next/image";
import { useReadContracts } from "wagmi";
import { isAddressEqual, zeroAddress } from "viem";
import { fmtUSD } from "@/lib/format";
import { Countdown } from "./Countdown";
import { useLang } from "@/lib/lang-provider";
import { ACTIVE_CHAIN, POT_ADDRESS } from "@/lib/chain";
import { FREAKING_POT_ABI } from "@/lib/onchain";
import type { Lang } from "@/lib/i18n";

const GAMES: { id: Lang; gameId: bigint; label: string }[] = [
  { id: "en", gameId: 1n, label: "English" },
  { id: "es", gameId: 2n, label: "Español" },
];

export function PotHeader({ closesAtIso }: { closesAtIso: string }) {
  const { t, game, setGame } = useLang();
  const enabled = !isAddressEqual(POT_ADDRESS, zeroAddress);

  const { data: days } = useReadContracts({
    contracts: GAMES.map((g) => ({
      address: POT_ADDRESS,
      abi: FREAKING_POT_ABI,
      functionName: "currentDay",
      args: [g.gameId],
      chainId: ACTIVE_CHAIN.id,
    })),
    query: { enabled, refetchInterval: 15_000 },
  });

  const enDay = days?.[0]?.result as bigint | undefined;
  const esDay = days?.[1]?.result as bigint | undefined;

  const { data: pots } = useReadContracts({
    contracts: [
      {
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "viewPot",
        args: [GAMES[0].gameId, enDay ?? 0n],
        chainId: ACTIVE_CHAIN.id,
      },
      {
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "viewPot",
        args: [GAMES[1].gameId, esDay ?? 0n],
        chainId: ACTIVE_CHAIN.id,
      },
    ],
    query: { enabled: enabled && !!enDay && !!esDay, refetchInterval: 15_000 },
  });

  const pot0 = pots?.[0]?.result as bigint | undefined;
  const pot1 = pots?.[1]?.result as bigint | undefined;
  const potUSD = [pot0, pot1].map((p) =>
    p != null ? Number(p) / 1_000_000 : null,
  );

  return (
    <div className="relative overflow-hidden rounded-3xl bg-teal text-white px-5 pt-5 pb-6 shadow-[0_8px_0_0_rgba(0,0,0,0.06)]">
      <div className="absolute -right-6 -top-6 opacity-20">
        <Image src="/erudito.png" alt="" width={140} height={140} priority />
      </div>

      <div className="relative z-10 flex items-center justify-between">
        <div className="font-display text-sm tracking-[0.25em] uppercase opacity-90">
          {t.pickGame}
        </div>
        <div className="inline-flex items-center gap-2 bg-white/15 rounded-full px-3 py-1.5 backdrop-blur-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          <span className="text-xs font-display tracking-wider uppercase opacity-90">
            {t.closesIn}
          </span>
          <Countdown
            targetIso={closesAtIso}
            className="font-mono text-sm tabular-nums"
          />
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-2 gap-2 mt-4">
        {GAMES.map((g, i) => {
          const active = game === g.id;
          const pot = potUSD[i];
          return (
            <button
              key={g.id}
              onClick={() => setGame(g.id)}
              className={`rounded-2xl px-3 py-3 text-left transition relative ${
                active
                  ? "bg-white/25 ring-2 ring-yellow"
                  : "bg-white/[0.08] opacity-75 hover:opacity-100"
              }`}
              aria-pressed={active}
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-sm tracking-[0.2em] uppercase">
                  {g.id} pot
                </span>
                {active && (
                  <span className="w-2 h-2 rounded-full bg-yellow" />
                )}
              </div>
              <div
                className={`font-display text-[clamp(2rem,9vw,3rem)] leading-none tabular-nums mt-1 ${
                  active ? "text-yellow" : "text-white"
                }`}
              >
                {pot != null ? fmtUSD(pot) : "—"}
              </div>
              <div className="font-display text-xs tracking-wider uppercase opacity-80 mt-1">
                {g.label}
              </div>
            </button>
          );
        })}
      </div>

      <div className="relative z-10 font-display text-base tracking-wider uppercase opacity-95 mt-4 text-center">
        {t.winnerTakesAll}
      </div>
    </div>
  );
}
