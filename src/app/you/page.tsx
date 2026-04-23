"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useLogin } from "@privy-io/react-auth";
import { isAddressEqual, zeroAddress } from "viem";
import { Button } from "@/components/Button";
import { MailIcon, WalletIcon } from "@/components/PayAndPlayButton";
import { fmtUSD } from "@/lib/format";
import { getStats, getUnclaimed, type UnclaimedWin } from "@/lib/api";
import { useCurrentPlayer } from "@/lib/wallet";
import { ACTIVE_CHAIN, POT_ADDRESS } from "@/lib/chain";
import { useLang } from "@/lib/lang-provider";
import { gameIdFor, type Lang } from "@/lib/i18n";
import FreakingPotArtifact from "@/lib/contracts/FreakingPot.json";
import { SakaLabsCredit } from "@/components/SakaLabsCredit";
import { PlayerName } from "@/components/PlayerName";
import { WalletSection } from "@/components/WalletSection";

const FREAKING_POT_ABI = FreakingPotArtifact.abi;

const LANGS: Lang[] = ["en", "es"];

type AggregatedStats = {
  gamesPlayed: number;
  wins: number;
  totalEarnedUSD: number;
};

type TaggedWin = UnclaimedWin & { lang: Lang };

export default function YouPage() {
  const { t } = useLang();
  const [stats, setStats] = useState<AggregatedStats | null>(null);
  const [unclaimed, setUnclaimed] = useState<TaggedWin[] | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const { address: player } = useCurrentPlayer();
  const { isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { login: privyLogin } = useLogin();
  const { disconnect } = useDisconnect();
  const router = useRouter();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN.id });

  useEffect(() => {
    if (!player) return;
    // Aggregate stats + unclaimed across BOTH games — a "You" page scoped to
    // one pot hides the other game's winnings. Each item is tagged with its
    // lang so Claim All can split into per-game txs below.
    Promise.all(
      LANGS.flatMap((l) => [
        getStats(l, player),
        getUnclaimed(l, player).then((ws) =>
          ws.map((w) => ({ ...w, lang: l })),
        ),
      ]),
    ).then((results) => {
      const statsByLang = [results[0], results[2]] as [
        Awaited<ReturnType<typeof getStats>>,
        Awaited<ReturnType<typeof getStats>>,
      ];
      const winsByLang = [results[1], results[3]] as [TaggedWin[], TaggedWin[]];
      setStats({
        gamesPlayed: statsByLang[0].gamesPlayed + statsByLang[1].gamesPlayed,
        wins: statsByLang[0].wins + statsByLang[1].wins,
        totalEarnedUSD:
          statsByLang[0].totalEarnedUSD + statsByLang[1].totalEarnedUSD,
      });
      setUnclaimed(
        [...winsByLang[0], ...winsByLang[1]].sort((a, b) =>
          b.date.localeCompare(a.date),
        ),
      );
    });
  }, [player]);

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
        openConnectModal?.();
        setClaiming(false);
        return;
      }
      if (chainId !== ACTIVE_CHAIN.id) {
        await switchChainAsync({ chainId: ACTIVE_CHAIN.id });
      }
      if (!publicClient) throw new Error("no-rpc");

      // Split wins by game and send one claimMultiple() call per game. The
      // contract tracks pots per (gameId, day), so we can't batch across games.
      const byLang: Record<Lang, bigint[]> = { en: [], es: [] };
      for (const w of unclaimed) byLang[w.lang].push(BigInt(w.dayNumber));

      for (const l of LANGS) {
        const days = byLang[l];
        if (days.length === 0) continue;
        const hash = await writeContractAsync({
          chainId: ACTIVE_CHAIN.id,
          address: POT_ADDRESS,
          abi: FREAKING_POT_ABI,
          functionName: "claimMultiple",
          args: [days, BigInt(gameIdFor(l))],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }

      // Optimistic clear. Server will flip rows to claimed=true eventually.
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

      {!isConnected && (
        <section className="flex-1 flex flex-col items-center justify-center gap-5 text-center py-10">
          <Image src="/mascot.png" alt="" width={96} height={96} priority />
          <div>
            <h2 className="font-display text-2xl tracking-wide">
              {t.youSignInTitle}
            </h2>
            <p className="text-sm text-muted mt-2 max-w-[20rem] leading-snug">
              {t.youSignInBlurb}
            </p>
          </div>
          <div className="w-full flex flex-col gap-2">
            <Button full onClick={() => privyLogin({ loginMethods: ["email"] })}>
              <span className="inline-flex items-center gap-2">
                <MailIcon />
                {t.signInWithEmail}
              </span>
            </Button>
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-black/10" />
              <span className="text-[10px] font-display tracking-[0.25em] uppercase text-muted">
                {t.or}
              </span>
              <div className="flex-1 h-px bg-black/10" />
            </div>
            <Button full variant="ghost" onClick={() => openConnectModal?.()}>
              <span className="inline-flex items-center gap-2">
                <WalletIcon />
                {t.useYourOwnWallet}
              </span>
            </Button>
          </div>
        </section>
      )}

      {isConnected && (
      <>
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
            {t.noPendingWins}
          </div>
        )}
        {unclaimed && unclaimed.length > 0 && (
          <div className="rounded-3xl bg-white border border-black/5 overflow-hidden shadow-[0_4px_0_0_rgba(0,0,0,0.04)]">
            <ul className="divide-y divide-black/5">
              {unclaimed.map((w) => (
                <li
                  key={`${w.lang}-${w.date}`}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <div className="text-xs font-display tracking-widest uppercase text-muted flex items-center gap-2">
                      <span>{w.date}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                          w.lang === "en"
                            ? "bg-teal/20 text-teal"
                            : "bg-purple/20 text-purple"
                        }`}
                      >
                        {w.lang.toUpperCase()}
                      </span>
                    </div>
                    <div className="font-display text-2xl">{fmtUSD(w.amountUSD)}</div>
                  </div>
                  <span className="text-xs font-display tracking-wider uppercase text-teal">
                    {t.readyBadge}
                  </span>
                </li>
              ))}
            </ul>
            <div className="p-3 bg-black/[0.02] flex flex-col gap-2">
              <Button full disabled={claiming} onClick={handleClaimAll}>
                {claiming ? t.claimingStatus : `${t.claimAll}  ·  ${fmtUSD(total)}`}
              </Button>
              {claimError && (
                <p className="text-xs text-red text-center font-mono">{claimError}</p>
              )}
            </div>
          </div>
        )}
      </section>
      </>
      )}

      {isConnected && <WalletSection />}

      {isConnected && (
        <section className="mt-auto pt-4 pb-6">
          <button
            onClick={() => {
              disconnect();
              router.push("/");
            }}
            className="w-full rounded-2xl border border-black/10 bg-white px-5 h-12 font-display text-sm tracking-widest uppercase text-muted hover:text-red hover:border-red/30 transition shadow-[0_2px_0_0_rgba(0,0,0,0.04)]"
          >
            {t.disconnectWallet}
          </button>
          <p className="text-[11px] text-muted text-center mt-2">
            {t.disconnectHint}
          </p>
        </section>
      )}
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
