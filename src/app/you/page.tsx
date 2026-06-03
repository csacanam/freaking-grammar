"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  useAccount,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useLogin, useLogout, usePrivy } from "@privy-io/react-auth";
import { isAddressEqual, zeroAddress } from "viem";
import { Button } from "@/components/Button";
import { MailIcon, WalletIcon } from "@/components/PayAndPlayButton";
import { fmtUSD } from "@/lib/format";
import { getStats, getUnclaimed, type UnclaimedWin } from "@/lib/api";
import { useCurrentPlayer } from "@/lib/wallet";
import { ACTIVE_CHAIN, POT_ADDRESS } from "@/lib/chain";
import { useLang } from "@/lib/lang-provider";
import FreakingPotArtifact from "@/lib/contracts/FreakingPot.json";
import { SakaLabsCredit } from "@/components/SakaLabsCredit";
import { PlayerName } from "@/components/PlayerName";
import { WalletSection } from "@/components/WalletSection";
import { useIsMiniPay } from "@/lib/minipay";

const FREAKING_POT_ABI = FreakingPotArtifact.abi;

type AggregatedStats = {
  gamesPlayed: number;
  wins: number;
  totalEarnedUSD: number;
};

export default function YouPage() {
  const { t } = useLang();
  const [stats, setStats] = useState<AggregatedStats | null>(null);
  const [unclaimed, setUnclaimed] = useState<UnclaimedWin[] | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const { address: player } = useCurrentPlayer();
  const { isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { login: privyLogin } = useLogin();
  const { logout: privyLogout } = useLogout();
  const { authenticated: privyAuthenticated } = usePrivy();
  const { disconnectAsync } = useDisconnect();
  const inMiniPay = useIsMiniPay();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN.id });

  useEffect(() => {
    if (!player) return;
    // The endpoints aggregate across every game now — Math is included
    // automatically. Each unclaimed win carries its gameId so the claim
    // flow below can group per game and call claimMultiple once per
    // game.
    Promise.all([getStats(player), getUnclaimed(player)]).then(
      ([s, wins]) => {
        setStats(s);
        setUnclaimed(wins.sort((a, b) => b.date.localeCompare(a.date)));
      },
    );
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

      // Split wins by gameId and send one claimMultiple() call per
      // game. The contract tracks pots per (gameId, day), so we can't
      // batch across games. Works for any number of games — Math
      // (gameId=3) plugs into the same loop as Grammar EN/ES.
      const byGameId = new Map<number, bigint[]>();
      for (const w of unclaimed) {
        if (!byGameId.has(w.gameId)) byGameId.set(w.gameId, []);
        byGameId.get(w.gameId)!.push(BigInt(w.dayNumber));
      }

      for (const [gameId, days] of byGameId) {
        if (days.length === 0) continue;
        const hash = await writeContractAsync({
          chainId: ACTIVE_CHAIN.id,
          address: POT_ADDRESS,
          abi: FREAKING_POT_ABI,
          functionName: "claimMultiple",
          args: [days, BigInt(gameId)],
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

      {!isConnected && inMiniPay && (
        <section className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-10">
          <Image src="/mascot.png" alt="" width={64} height={64} priority />
          <p className="text-sm text-muted">{t.miniPayConnecting}</p>
        </section>
      )}
      {!isConnected && !inMiniPay && (
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
              {unclaimed.map((w) => {
                // Per-game badge: Grammar EN/ES use the existing teal/
                // purple tints; Math (lang=null) gets orange to match
                // its lobby accent stripe.
                const badgeLabel =
                  w.game === "math" ? "MATH" : (w.lang ?? "").toUpperCase();
                const badgeClass =
                  w.game === "math"
                    ? "bg-orange/20 text-orange"
                    : w.lang === "en"
                    ? "bg-teal/20 text-teal"
                    : "bg-purple/20 text-purple";
                return (
                <li
                  key={`${w.gameId}-${w.date}`}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <div className="text-xs font-display tracking-widest uppercase text-muted flex items-center gap-2">
                      <span>{w.date}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${badgeClass}`}
                      >
                        {badgeLabel}
                      </span>
                    </div>
                    <div className="font-display text-2xl">{fmtUSD(w.amountUSD)}</div>
                  </div>
                  <span className="text-xs font-display tracking-wider uppercase text-teal">
                    {t.readyBadge}
                  </span>
                </li>
                );
              })}
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
            onClick={async () => {
              // Goal of this handler: leave the browser in the same state
              // as if the user had never signed in, so the next login is
              // a true cold start (no "last used wallet" hints, no auto-
              // reconnect, no stale React/wagmi/Privy in-memory state).
              //
              // Order matters:
              //   1. Privy logout FIRST so useWallets() empties out —
              //      otherwise PrivyEmbeddedBridge would re-add the
              //      embedded wallet connector right after disconnect().
              //   2. wagmi disconnect (awaited via disconnectAsync so we
              //      know the store has actually flushed before we move
              //      on; the sync `disconnect()` is fire-and-forget).
              //   3. Wipe wagmi / WalletConnect / Reown localStorage
              //      entries by hand. wagmi's `disconnect()` clears its
              //      own active connector but not WC pairing metadata,
              //      and RainbowKit/Reown leave their own keys behind —
              //      both surface as a "last used" hint on the next
              //      login modal.
              //   4. Hard navigate (window.location, not router.push) so
              //      every provider re-mounts cold. Soft nav leaves
              //      hooks holding stale closures of the previous user.
              try {
                if (privyAuthenticated) {
                  await privyLogout();
                }
              } catch {
                /* still try to clean up the wagmi side */
              }
              try {
                await disconnectAsync();
              } catch {
                /* nothing connected, or already disconnected */
              }
              try {
                for (const k of Object.keys(localStorage)) {
                  if (/^(wagmi|wc@|walletconnect|W3M\/|@w3m\/|@reown\/)/i.test(k)) {
                    localStorage.removeItem(k);
                  }
                }
              } catch {
                /* private mode / disabled storage — best effort */
              }
              window.location.href = "/";
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
