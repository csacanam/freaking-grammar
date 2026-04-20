"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useConnect,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
  type Connector,
} from "wagmi";
import { erc20Abi, isAddressEqual, maxUint256, zeroAddress } from "viem";
import { Button } from "@/components/Button";
import { Countdown } from "@/components/Countdown";
import { WalletPicker } from "@/components/WalletPicker";
import { friendlyError } from "@/lib/format";
import {
  ACTIVE_CHAIN,
  ENTRY_FEE_UNITS,
  POT_ADDRESS,
  STABLECOIN,
} from "@/lib/wagmi";
import { useLang } from "@/lib/lang-provider";
import FreakingPotArtifact from "@/lib/contracts/FreakingPot.json";

const FREAKING_POT_ABI = FreakingPotArtifact.abi;

type Stage =
  | "idle"
  | "connecting"
  | "switching"
  | "approving"
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
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN.id });

  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pendingRef = useRef(false);

  const contractLive = !isAddressEqual(POT_ADDRESS, zeroAddress);
  const token = STABLECOIN[ACTIVE_CHAIN.id];

  const resetIso = useMemo(() => {
    const d = new Date();
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1),
    ).toISOString();
  }, []);

  async function runPaidFlow(currentAddress: `0x${string}`) {
    if (!publicClient) throw new Error("no-rpc");

    if (chainId !== ACTIVE_CHAIN.id) {
      setStage("switching");
      await switchChainAsync({ chainId: ACTIVE_CHAIN.id });
    }

    const allowance = (await publicClient.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [currentAddress, POT_ADDRESS],
    })) as bigint;

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

    setStage("paying");
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

    // Wallet required for any play — free or paid. Keeps the leaderboard
    // to real addresses and lets winners actually claim on-chain.
    if (!isConnected || !address) {
      pendingRef.current = true;
      setPickerOpen(true);
      return;
    }

    if (playerHasFreePlay) {
      router.push(`/game?game=${game}`);
      return;
    }
    if (!contractLive) return;

    try {
      await runPaidFlow(address);
    } catch (e) {
      console.error("pay-and-play failed:", e);
      setError(friendlyError(e, 120));
      setStage("idle");
    }
  }

  async function onPickWallet(c: Connector) {
    setPickerOpen(false);
    const wasPending = pendingRef.current;
    pendingRef.current = false;
    try {
      setStage("connecting");
      const result = await connectAsync({ connector: c });
      const addr = result.accounts[0];
      if (!addr) throw new Error("no-wallet");

      if (!wasPending) {
        setStage("idle");
        return;
      }
      // Resume the play intent now that we have a wallet.
      if (playerHasFreePlay) {
        router.push(`/game?game=${game}`);
        return;
      }
      if (!contractLive) {
        setStage("idle");
        return;
      }
      await runPaidFlow(addr);
    } catch (e) {
      console.error("pay-and-play connect failed:", e);
      setError(friendlyError(e, 120));
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

  return (
    <div className="flex flex-col gap-2">
      <Button full onClick={handleClick} disabled={busy || isLocked}>
        {label}
      </Button>
      {!busy && isPaid && (
        <p className="text-xs text-center font-display tracking-widest uppercase text-muted">
          {t.potShare}
        </p>
      )}
      {!busy && !playerHasFreePlay && (
        <p className="text-xs text-center font-display tracking-widest uppercase text-muted">
          {t.freeAgainIn}{" "}
          <Countdown targetIso={resetIso} className="font-mono tabular-nums" />
        </p>
      )}
      {error && (
        <p className="text-xs text-red text-center font-mono">{error}</p>
      )}
      <WalletPicker
        open={pickerOpen}
        connectors={connectors}
        onSelect={onPickWallet}
        onClose={() => {
          pendingRef.current = false;
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function stageLabel(s: Stage): string {
  switch (s) {
    case "connecting":
      return "Connecting wallet…";
    case "switching":
      return "Switching network…";
    case "approving":
      return "Approving USDT…";
    case "paying":
      return "Paying $0.10…";
    case "starting":
      return "Starting…";
    default:
      return "…";
  }
}
