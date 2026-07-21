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
  type Abi,
  encodeFunctionData,
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
import { useIsMiniPay, useTxOverrides } from "@/lib/minipay";
import { posthog } from "@/lib/posthog-provider";
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
  app = "grammar",
}: {
  playerHasFreePlay: boolean;
  replay?: boolean;
  // Optional: pot cards pass their own game explicitly so the button drives
  // the right pot regardless of the URL ?game= selection. Falls back to the
  // lang context for legacy callers (game/over page). Only relevant for
  // app='grammar'; for app='math' the game is fixed (gameId=3, no lang).
  game?: Lang;
  // Which app this button drives. Math reuses the same on-chain `play`
  // entrypoint (the contract is multi-game) but with gameId=3 and a
  // different post-payment redirect.
  app?: "grammar" | "math";
}) {
  const router = useRouter();
  const { t, game: ctxGame } = useLang();
  const game = gameOverride ?? ctxGame;
  const gameId = app === "math" ? 3 : gameIdFor(game);
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN.id });
  const { openConnectModal } = useConnectModal();
  const { login: privyLogin } = useLogin();
  const inMiniPay = useIsMiniPay();
  const txOverrides = useTxOverrides();

  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  // Raw wallet/SDK error message, surfaced on-screen for remote debugging of
  // the MiniPay "Transaction rejected" report. Lets a remote tester screenshot
  // the exact underlying error (which friendlyError() collapses away) without
  // needing USB / chrome://inspect. Temporary diagnostic.
  const [rawError, setRawError] = useState<string | null>(null);
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

    // Pre-estimate gas against our own RPC (Forno via publicClient) and pass
    // it explicitly to writeContract, so viem does NOT fire `eth_estimateGas`
    // against MiniPay's injected provider. That estimation is the step that
    // dies pre-flight for the `approve` inside MiniPay — the wallet throws
    // before showing its signing sheet, surfacing as an immediate red
    // "Transaction rejected" with no modal. The fee-per-gas calls
    // (eth_gasPrice / eth_maxPriorityFeePerGas with the CIP-64 adapter) are
    // network-level and work fine, so we leave those to viem. If our own
    // estimate fails for any reason we return undefined and fall back to the
    // wallet's estimation (the pre-fix behaviour) — never worse than today.
    async function estimateGasSafe(
      to: `0x${string}`,
      data: `0x${string}`,
    ): Promise<bigint | undefined> {
      try {
        const gas = await publicClient!.estimateGas({
          account: currentAddress,
          to,
          data,
          // feeCurrency mirrors the writeContract override (CIP-64) so the
          // estimate is computed under the same gas-payment path.
          ...(txOverrides.feeCurrency
            ? { feeCurrency: txOverrides.feeCurrency }
            : {}),
        });
        return (gas * 12n) / 10n; // +20% buffer over the estimate
      } catch (e) {
        console.warn("gas pre-estimate failed, deferring to wallet:", e);
        return undefined;
      }
    }

    if (chainId !== ACTIVE_CHAIN.id) {
      setStage("switching");
      await switchChainAsync({ chainId: ACTIVE_CHAIN.id });
    }

    // Gas check. The wallet pre-flight rejects when
    // `balance < gas_limit × max_fee_per_gas`. We measured max_fee
    // sitting at ~5x the effective gas price (480 vs 100 gwei) as
    // the wallet's safety buffer, so a paid play needs ~0.04 CELO
    // reserved even though the chain only charges ~0.008 once
    // settled. Real-world: a user at 0.0384 CELO got a paid play
    // rejected pre-flight by 0.0005 CELO. Thresholds match wallet
    // demand, not actual chain cost.
    //
    // Skip inside MiniPay: fee abstraction pays gas out of the
    // user's USDT via the CIP-64 adapter, so the validator never
    // touches their CELO balance (which is always 0 there by
    // design). Running this check anyway would trigger an
    // insufficient-CELO modal for every MiniPay user even though
    // their tx would have settled fine.
    if (!inMiniPay) {
      const MIN_CELO_FREE = parseEther("0.02"); // free play pre-flight + buffer
      const MIN_CELO_PAID = parseEther("0.05"); // paid play (with approve) pre-flight + buffer
      const minCelo = playerHasFreePlay ? MIN_CELO_FREE : MIN_CELO_PAID;
      const celoBal = await publicClient.getBalance({ address: currentAddress });
      if (celoBal < minCelo) {
        setNeedFunds({
          token: "CELO",
          balance: formatEther(celoBal),
          need: "0.05",
          address: currentAddress,
        });
        setStage("idle");
        throw new Error("insufficient-celo");
      }
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
        const approveGas = await estimateGasSafe(
          token.address,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [POT_ADDRESS, maxUint256],
          }),
        );
        const approveHash = await writeContractAsync({
          chainId: ACTIVE_CHAIN.id,
          address: token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [POT_ADDRESS, maxUint256],
          ...(approveGas ? { gas: approveGas } : {}),
          ...txOverrides,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
    }

    setStage(playerHasFreePlay ? "signing" : "paying");
    const playGas = await estimateGasSafe(
      POT_ADDRESS,
      encodeFunctionData({
        abi: FREAKING_POT_ABI as Abi,
        functionName: "play",
        args: [BigInt(gameId)],
      }),
    );
    const playHash = await writeContractAsync({
      chainId: ACTIVE_CHAIN.id,
      address: POT_ADDRESS,
      abi: FREAKING_POT_ABI,
      functionName: "play",
      args: [BigInt(gameId)],
      ...(playGas ? { gas: playGas } : {}),
      ...txOverrides,
    });
    // Once writeContractAsync returns a hash, the wallet broadcast the tx
    // — the contract has either already used the free play or charged
    // USDT, regardless of what happens next. So if the receipt wait
    // fails (RPC hiccup, mini-app frame dropping), we still navigate to
    // /game with the hash; the game page will pick up the run server-
    // side and the user gets to play. Treating this as a "rejected"
    // would silently lose their free play even though the chain
    // already counted it.
    try {
      await publicClient.waitForTransactionReceipt({ hash: playHash });
    } catch (e) {
      console.warn("waitForTransactionReceipt failed (tx already broadcast):", e);
    }

    setStage("starting");
    const dest =
      app === "math"
        ? `/math/game?tx=${playHash}`
        : `/grammar/game?tx=${playHash}&game=${game}`;
    router.push(dest);
  }

  async function handleClick() {
    setError(null);
    setRawError(null);

    if (!contractLive) return;
    if (!isConnected || !address) return; // handled by login buttons

    try {
      await runPlayFlow(address);
    } catch (e) {
      // Always log the raw error to console for debugging — friendlyError()
      // collapses everything to short user-facing text and we lose the
      // wallet/SDK signal in the process. Keeps "Transaction rejected"
      // diagnosable next time it shows up.
      console.error("pay-and-play failed:", e);
      const err = e as Error;
      console.error("pay-and-play raw message:", err?.message);
      console.error("pay-and-play stack:", err?.stack);
      // Insufficient-funds cases are already surfaced via NeedFundsModal.
      const msg = err?.message;
      if (msg !== "insufficient-usdt" && msg !== "insufficient-celo") {
        setError(friendlyError(e, 120));
        // Surface the raw error remotely: on-screen (screenshot-able) + to
        // PostHog, so we can pin the exact cause of the MiniPay approve
        // failure from a remote tester without USB debugging. viem wraps the
        // provider error as "unknown RPC error", so dig into the nested
        // cause/details for MiniPay's actual message + code.
        const detail = extractErrorDetail(e);
        setRawError(detail.slice(0, 400));
        try {
          posthog.capture("pay_and_play_error", {
            stage,
            raw_message: (err?.message ?? String(e)).slice(0, 500),
            error_detail: detail.slice(0, 800),
            error_name: err?.name ?? null,
            in_minipay: inMiniPay,
            has_free_play: playerHasFreePlay,
            fee_currency: txOverrides.feeCurrency ?? null,
            address: address?.toLowerCase() ?? null,
            game_id: gameId,
          });
        } catch {
          // never let analytics throw over the real error path
        }
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
  //
  // MiniPay branch: neither sign-in option applies inside MiniPay — the
  // user is already in their wallet and MiniPayBridge is auto-connecting
  // in the background. Show a quiet "Connecting…" placeholder instead so
  // we don't (a) flash a Connect-Wallet button (forbidden by listing
  // rules) or (b) tempt the user into the Privy email flow they can't
  // complete from a wallet context.
  if (needsConnect && inMiniPay) {
    return (
      <Button full disabled>
        {t.miniPayConnecting}
      </Button>
    );
  }
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
            <span className="text-sm tracking-[0.15em] uppercase text-white font-display">
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
      {rawError && (
        <p className="text-[10px] text-muted text-center font-mono break-all select-all opacity-70">
          debug: {rawError}
        </p>
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

// Dig into a viem error chain to surface the *underlying* provider message.
// viem throws e.g. UnknownRpcError("An unknown RPC error occurred") at the
// top, but MiniPay's real message + JSON-RPC code live in nested cause/details.
// Walk the cause chain and collect shortMessage/details/code so a remote
// tester's screenshot tells us exactly why MiniPay refused the tx. Temporary.
function extractErrorDetail(e: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let node: unknown = e;
  let depth = 0;
  while (node && !seen.has(node) && depth < 6) {
    seen.add(node);
    const n = node as {
      shortMessage?: string;
      details?: string;
      code?: number | string;
      name?: string;
      message?: string;
      cause?: unknown;
    };
    if (n.details) parts.push(`details: ${n.details}`);
    if (n.code !== undefined) parts.push(`code: ${n.code}`);
    if (!n.details && !n.shortMessage && n.message) {
      parts.push(n.message.split("\n")[0]);
    }
    node = n.cause;
    depth++;
  }
  const joined = parts.join(" | ");
  return joined || (e as Error)?.message || String(e);
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
