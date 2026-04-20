"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  useAccount,
  useConnect,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { isAddressEqual, zeroAddress } from "viem";
import { Button } from "@/components/Button";
import { fmtUSD } from "@/lib/format";
import { getStats, getUnclaimed, type StatsData, type UnclaimedWin } from "@/lib/api";
import { useCurrentPlayer } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";
import { ACTIVE_CHAIN, POT_ADDRESS } from "@/lib/wagmi";
import { useLang } from "@/lib/lang-provider";
import FreakingPotArtifact from "@/lib/contracts/FreakingPot.json";
import { SakaLabsCredit } from "@/components/SakaLabsCredit";
import { PlayerName } from "@/components/PlayerName";

const FREAKING_POT_ABI = FreakingPotArtifact.abi;

export default function YouPage() {
  const { t, game, gameId } = useLang();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [unclaimed, setUnclaimed] = useState<UnclaimedWin[] | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const { address: player } = useCurrentPlayer();
  const { isConnected, chainId } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN.id });

  useEffect(() => {
    if (!player) return;
    Promise.all([getStats(game, player), getUnclaimed(game, player)]).then(
      ([s, u]) => {
        setStats(s);
        setUnclaimed(u);
      },
    );
  }, [player, game]);

  const total = (unclaimed ?? []).reduce((s, w) => s + w.amountUSD, 0);
  const contractLive = !isAddressEqual(POT_ADDRESS, zeroAddress);

  async function handleClaimAll() {
    if (!unclaimed?.length) return;
    setClaimError(null);
    setClaiming(true);

    if (!contractLive) {
      setClaimError("Contract not deployed yet.");
      setClaiming(false);
      return;
    }

    try {
      if (!isConnected) {
        await connectAsync({ connector: connectors[0] });
      }
      if (chainId !== ACTIVE_CHAIN.id) {
        await switchChainAsync({ chainId: ACTIVE_CHAIN.id });
      }
      if (!publicClient) throw new Error("no-rpc");

      const days = unclaimed.map((w) => BigInt(w.dayNumber));
      const hash = await writeContractAsync({
        chainId: ACTIVE_CHAIN.id,
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "claimMultiple",
        args: [days, BigInt(gameId)],
      });
      await publicClient.waitForTransactionReceipt({ hash });

      // Re-pull from the server; rows should flip to claimed=true eventually,
      // but for immediate UX we clear locally.
      setUnclaimed([]);
    } catch (e) {
      const msg = (e as Error).message ?? "claim failed";
      setClaimError(msg.length > 120 ? msg.slice(0, 120) + "…" : msg);
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col px-5 pt-6 max-w-md mx-auto w-full gap-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-teal/20 flex items-center justify-center">
            <Image src="/erudito.png" alt="" width={32} height={32} />
          </div>
          <div>
            <h1 className="font-display text-3xl tracking-wider leading-none">{t.tabYou}</h1>
            <p className="text-xs text-muted mt-1">
              {player ? <PlayerName address={player} /> : "—"}
            </p>
          </div>
        </div>
        <SakaLabsCredit />
      </header>

      <section className="grid grid-cols-3 gap-3">
        <Stat label={t.gamesPlayed} value={stats?.gamesPlayed ?? "—"} accent="bg-blue/10" />
        <Stat label={t.wins} value={stats?.wins ?? "—"} accent="bg-yellow/40" />
        <Stat
          label={t.totalEarned}
          value={stats ? fmtUSD(stats.totalEarnedUSD) : "—"}
          accent="bg-teal/20"
        />
      </section>

      <section>
        <h2 className="font-display text-xl tracking-wide mb-2">{t.youHaveUnclaimed}</h2>
        {unclaimed === null && <div className="h-24 rounded-2xl bg-black/5 animate-pulse" />}
        {unclaimed?.length === 0 && (
          <div className="rounded-2xl bg-white border border-dashed border-black/10 p-6 text-center text-muted">
            🎯  No pending wins. Go play.
          </div>
        )}
        {unclaimed && unclaimed.length > 0 && (
          <div className="rounded-3xl bg-white border border-black/5 overflow-hidden shadow-[0_4px_0_0_rgba(0,0,0,0.04)]">
            <ul className="divide-y divide-black/5">
              {unclaimed.map((w) => (
                <li key={w.date} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="text-xs font-display tracking-widest uppercase text-muted">
                      {w.date}
                    </div>
                    <div className="font-display text-2xl">{fmtUSD(w.amountUSD)}</div>
                  </div>
                  <span className="text-xs font-display tracking-wider uppercase text-teal">
                    ready
                  </span>
                </li>
              ))}
            </ul>
            <div className="p-3 bg-black/[0.02] flex flex-col gap-2">
              <Button full disabled={claiming} onClick={handleClaimAll}>
                {claiming ? "Claiming…" : `${t.claimAll}  ·  ${fmtUSD(total)}`}
              </Button>
              {claimError && (
                <p className="text-xs text-red text-center font-mono">{claimError}</p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div className={`${accent} rounded-2xl px-3 py-3 text-center`}>
      <div className="text-[10px] font-display tracking-widest uppercase text-muted leading-tight">
        {label}
      </div>
      <div className="font-display text-2xl mt-1">{value}</div>
    </div>
  );
}
