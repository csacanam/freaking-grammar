"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { erc20Abi, isAddressEqual, maxUint256, zeroAddress } from "viem";
import { Button } from "@/components/Button";
import { Countdown } from "@/components/Countdown";
import { NeedUsdtModal } from "@/components/NeedUsdtModal";
import { friendlyError } from "@/lib/format";
import {
  ACTIVE_CHAIN,
  ENTRY_FEE_UNITS,
  POT_ADDRESS,
  STABLECOIN,
} from "@/lib/chain";
import { useLang } from "@/lib/lang-provider";
import FreakingPotArtifact from "@/lib/contracts/FreakingPot.json";

const FREAKING_POT_ABI = FreakingPotArtifact.abi;

type Stage =
  | "idle"
  | "switching"
  | "approving"
  | "signing"
  | "paying"
  | "starting";

export function PayAndPlayButton({
  playerHasFreePlay,
  replay = false,
}: {
  playerHasFreePlay: boolean;
  replay?: boolean;
}) {
  const router = useRouter();
  const { t, game, gameId } = useLang();
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN.id });
  const { openConnectModal } = useConnectModal();

  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [needUsdt, setNeedUsdt] = useState<{
    balance: number;
    address: string;
  } | null>(null);

  const contractLive = !isAddressEqual(POT_ADDRESS, zeroAddress);
  const token = STABLECOIN[ACTIVE_CHAIN.id];

  const resetIso = useMemo(() => {
    const d = new Date();
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1),
    ).toISOString();
  }, []);

  async function runPlayFlow(currentAddress: `0x${string}`) {
    if (!publicClient) throw new Error("no-rpc");

    if (chainId !== ACTIVE_CHAIN.id) {
      setStage("switching");
      await switchChainAsync({ chainId: ACTIVE_CHAIN.id });
    }

    // Approve + balance check only needed for paid plays — free plays don't
    // pull USDT. The contract itself decides free vs paid from `lastFreePlayDay`.
    if (!playerHasFreePlay) {
      const [balance, allowance] = (await Promise.all([
        publicClient.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [currentAddress],
        }),
        publicClient.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [currentAddress, POT_ADDRESS],
        }),
      ])) as [bigint, bigint];

      if (balance < ENTRY_FEE_UNITS) {
        setNeedUsdt({
          balance: Number(balance) / 1_000_000,
          address: currentAddress,
        });
        setStage("idle");
        throw new Error("insufficient-usdt");
      }

      if (allowance < ENTRY_FEE_UNITS) {
        setStage("approving");
        const approveHash = await writeContractAsync({
          chainId: ACTIVE_CHAIN.id,
          address: token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [POT_ADDRESS, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
    }

    setStage(playerHasFreePlay ? "signing" : "paying");
    const playHash = await writeContractAsync({
      chainId: ACTIVE_CHAIN.id,
      address: POT_ADDRESS,
      abi: FREAKING_POT_ABI,
      functionName: "play",
      args: [BigInt(gameId)],
    });
    await publicClient.waitForTransactionReceipt({ hash: playHash });

    setStage("starting");
    router.push(`/game?tx=${playHash}&game=${game}`);
  }

  async function handleClick() {
    setError(null);

    if (!contractLive) return;

    // Wallet required for any play — free or paid. Every play goes through
    // an on-chain play() call so fake addresses can't pollute the leaderboard.
    // Connect and play are separate actions: first click opens RainbowKit's
    // modal, user picks + signs, then clicks again to actually play.
    if (!isConnected || !address) {
      openConnectModal?.();
      return;
    }

    try {
      await runPlayFlow(address);
    } catch (e) {
      console.error("pay-and-play failed:", e);
      // "insufficient-usdt" is already surfaced via the NeedUsdtModal.
      if ((e as Error)?.message !== "insufficient-usdt") {
        setError(friendlyError(e, 120));
      }
      setStage("idle");
    }
  }

  const busy = stage !== "idle";
  const isPaid = !playerHasFreePlay && contractLive;
  const isLocked = !playerHasFreePlay && !contractLive;
  const needsConnect = !isConnected || !address;
  const paidVerb = replay ? t.playAgain : t.playPaid;
  const label = busy
    ? stageLabel(stage)
    : needsConnect
    ? t.connect
    : isLocked
    ? t.freePlayUsed
    : isPaid
    ? `▶  ${paidVerb}  ·  $0.10`
    : `▶  ${replay ? t.playAgain : t.playFree}`;

  // Caption folded into the button so it stays fixed at the bottom without
  // two separate lines of secondary text.
  const showCaption = !busy && !playerHasFreePlay;

  return (
    <div className="flex flex-col gap-2">
      <Button
        full
        onClick={handleClick}
        disabled={busy || isLocked}
        className={showCaption ? "!h-auto !py-2.5 !text-xl" : ""}
      >
        {showCaption ? (
          <span className="flex flex-col items-center leading-tight gap-1">
            <span>{label}</span>
            <span className="text-sm tracking-[0.15em] uppercase text-yellow font-display">
              {isPaid ? `${t.potShare}  ·  ` : ""}
              {t.freeAgainIn}{" "}
              <Countdown
                targetIso={resetIso}
                className="font-mono tabular-nums"
              />
            </span>
          </span>
        ) : (
          label
        )}
      </Button>
      {error && (
        <p className="text-xs text-red text-center font-mono">{error}</p>
      )}
      <NeedUsdtModal
        open={!!needUsdt}
        balanceUSD={needUsdt?.balance ?? 0}
        needUSD={0.1}
        walletAddress={needUsdt?.address}
        onClose={() => setNeedUsdt(null)}
      />
    </div>
  );
}

function stageLabel(s: Stage): string {
  switch (s) {
    case "switching":
      return "Switching network…";
    case "approving":
      return "Approving USDT…";
    case "signing":
      return "Signing play…";
    case "paying":
      return "Paying $0.10…";
    case "starting":
      return "Starting…";
    default:
      return "…";
  }
}
