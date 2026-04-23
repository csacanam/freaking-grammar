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
import { useLogin } from "@privy-io/react-auth";
import {
  erc20Abi,
  formatEther,
  isAddressEqual,
  maxUint256,
  parseEther,
  zeroAddress,
} from "viem";
import { Button } from "@/components/Button";
import { Countdown } from "@/components/Countdown";
import { NeedFundsModal } from "@/components/NeedFundsModal";
import { friendlyError } from "@/lib/format";
import {
  ACTIVE_CHAIN,
  ENTRY_FEE_UNITS,
  POT_ADDRESS,
  STABLECOIN,
} from "@/lib/chain";
import { useLang } from "@/lib/lang-provider";
import { gameIdFor, type Lang, type Strings } from "@/lib/i18n";
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
  game: gameOverride,
}: {
  playerHasFreePlay: boolean;
  replay?: boolean;
  // Optional: pot cards pass their own game explicitly so the button drives
  // the right pot regardless of the URL ?game= selection. Falls back to the
  // lang context for legacy callers (game/over page).
  game?: Lang;
}) {
  const router = useRouter();
  const { t, game: ctxGame } = useLang();
  const game = gameOverride ?? ctxGame;
  const gameId = gameIdFor(game);
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN.id });
  const { openConnectModal } = useConnectModal();
  const { login: privyLogin } = useLogin();

  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [needFunds, setNeedFunds] = useState<{
    token: "USDT" | "CELO";
    balance: string;
    need: string;
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

    // Gas check first — fails the nicest. Every play tx needs at least this
    // much CELO; if the wallet is short the play tx would either revert at
    // the wallet level or bubble up as a gas error. Surface it with the
    // NeedFundsModal instead.
    const MIN_CELO = parseEther("0.002");
    const celoBal = await publicClient.getBalance({ address: currentAddress });
    if (celoBal < MIN_CELO) {
      setNeedFunds({
        token: "CELO",
        balance: formatEther(celoBal),
        need: "0.01",
        address: currentAddress,
      });
      setStage("idle");
      throw new Error("insufficient-celo");
    }

    // Approve + USDT balance check only needed for paid plays — free plays
    // don't pull USDT. The contract itself decides free vs paid from
    // `lastFreePlayDay`.
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
        setNeedFunds({
          token: "USDT",
          balance: (Number(balance) / 1_000_000).toFixed(2),
          need: "0.10",
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
    if (!isConnected || !address) return; // handled by login buttons

    try {
      await runPlayFlow(address);
    } catch (e) {
      console.error("pay-and-play failed:", e);
      // Insufficient-funds cases are already surfaced via NeedFundsModal.
      const msg = (e as Error)?.message;
      if (msg !== "insufficient-usdt" && msg !== "insufficient-celo") {
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
  const playLabel = busy
    ? stageLabel(stage, t)
    : isLocked
    ? t.freePlayUsed
    : isPaid
    ? `▶  ${paidVerb}  ·  $0.10`
    : `▶  ${replay ? t.playAgain : t.playFree}`;

  // Caption folded into the button. When the user still has their free play,
  // surface the gameplay rules (5s timer + top-score-wins) so first-timers
  // don't burn their turn figuring out the mechanic. When free play is used,
  // switch to the pot-share + countdown messaging.
  const showCaption = !busy;

  // Pre-login UI: two explicit options instead of a single "Connect" button.
  // Primary = email via Privy (creates an embedded wallet, beginner-friendly).
  // Secondary = self-custody wallet via the RainbowKit modal — same picker
  // we've always had, just scoped to this button. The "OR" divider makes
  // both feel like valid first-class choices.
  if (needsConnect) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          full
          onClick={() => privyLogin({ loginMethods: ["email"] })}
          disabled={!contractLive}
        >
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
        <Button
          full
          variant="ghost"
          onClick={() => openConnectModal?.()}
          disabled={!contractLive}
        >
          <span className="inline-flex items-center gap-2">
            <WalletIcon />
            {t.useYourOwnWallet}
          </span>
        </Button>
      </div>
    );
  }

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
            <span>{playLabel}</span>
            <span className="text-sm tracking-[0.15em] uppercase text-yellow font-display">
              {playerHasFreePlay ? (
                <>⏱  {t.rulesHint}</>
              ) : (
                <>
                  {isPaid ? `${t.potShare}  ·  ` : ""}
                  {t.freeAgainIn}{" "}
                  <Countdown
                    targetIso={resetIso}
                    className="font-mono tabular-nums"
                  />
                </>
              )}
            </span>
          </span>
        ) : (
          playLabel
        )}
      </Button>
      {error && (
        <p className="text-xs text-red text-center font-mono">{error}</p>
      )}
      <NeedFundsModal
        open={!!needFunds}
        token={needFunds?.token ?? "USDT"}
        mode="insufficient"
        balance={needFunds?.balance}
        need={needFunds?.need}
        walletAddress={needFunds?.address}
        onClose={() => setNeedFunds(null)}
      />
    </div>
  );
}

export function MailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-[1em] w-[1em] shrink-0"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export function WalletIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-[1em] w-[1em] shrink-0"
    >
      <path d="M3 7a2 2 0 0 1 2-2h14v4" />
      <path d="M3 7v12a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-3" />
      <path d="M21 12v4h-4a2 2 0 0 1 0-4h4z" />
    </svg>
  );
}

function stageLabel(s: Stage, t: Strings): string {
  switch (s) {
    case "switching":
      return t.stageSwitching;
    case "approving":
      return t.stageApproving;
    case "signing":
      return t.stageSigning;
    case "paying":
      return t.stagePaying;
    case "starting":
      return t.stageStarting;
    default:
      return "…";
  }
}
