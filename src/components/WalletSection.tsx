"use client";

import { useEffect, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  erc20Abi,
  formatUnits,
  isAddress,
  parseUnits,
  type Hex,
} from "viem";
import { Button } from "@/components/Button";
import { NeedFundsModal } from "@/components/NeedFundsModal";
import { ACTIVE_CHAIN, STABLECOIN } from "@/lib/chain";
import { friendlyError } from "@/lib/format";
import { useLang } from "@/lib/lang-provider";
import { tpl } from "@/lib/i18n";
import { useIsMiniPay } from "@/lib/minipay";

const COPM_TOKEN = {
  address: "0x8A567e2aE79CA692Bd748aB832081C45de4041eA" as `0x${string}`,
  symbol: "COPm",
  decimals: 18,
};

type TokenBalance = {
  symbol: string;
  address?: `0x${string}`; // undefined for native CELO
  decimals: number;
  displayDecimals: number; // how many decimals to show in the UI
  balance: bigint;
  label: string;     // human-friendly name ("Digital US Dollar")
  purpose: string;   // why it exists for the user
  canAdd: boolean;   // whether Top-up flow supports this token
  tint: string;      // per-token background tint class for visual identity
};

// Trims the full-precision bigint amount to something a human wants to
// look at. "1145367.240248666084490678 COPm" → "1,145,367.24". Keeps
// "<0.0001" for dust so users know there's *something* there without
// rounding to a misleading "0.00".
function formatBalance(
  balance: bigint,
  decimals: number,
  display: number,
): string {
  const human = Number(formatUnits(balance, decimals));
  if (balance > 0n && human < Math.pow(10, -display)) {
    return `<${Math.pow(10, -display).toFixed(display)}`;
  }
  return human.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: display,
  });
}

// Universal wallet section — works with any connected wallet (Privy embedded,
// MetaMask, Rabby, MiniPay, Farcaster). Shows the address + balances for the
// tokens the app deals with and lets the user move them out.
//
// MiniPay branch: hides both the CELO row and the COPm row.
//   - CELO: MiniPay handles fees out of band via CIP-64 fee abstraction,
//     so the user never needs to look at it. Listing rules forbid showing
//     it.
//   - COPm: the sponsor token from the Celo Colombia campaign. MiniPay
//     listing rules accept USDT / USDC / USDm only, and the campaign is
//     `active=false` so no new COPm flows in — leaving a stale balance
//     row in the MiniPay UI just creates a "what is this?" question with
//     no follow-up action.
// USDT stays visible because that's what the app charges in.
export function WalletSection() {
  const { t } = useLang();
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const inMiniPay = useIsMiniPay();

  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [copied, setCopied] = useState(false);
  const [sendFor, setSendFor] = useState<TokenBalance | null>(null);
  const [topUpFor, setTopUpFor] = useState<"USDT" | "CELO" | null>(null);

  const usdt = STABLECOIN[ACTIVE_CHAIN.id];

  useEffect(() => {
    let alive = true;
    if (!address || !publicClient) return;

    (async () => {
      try {
        const [usdtBal, copmBal, celoBal] = (await Promise.all([
          publicClient.readContract({
            address: usdt.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          }),
          publicClient.readContract({
            address: COPM_TOKEN.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          }),
          publicClient.getBalance({ address }),
        ])) as [bigint, bigint, bigint];
        if (!alive) return;
        setBalances([
          // CELO first because it's foundational — without it no tx can
          // be signed. Then USDT (paid plays + winnings), then COPm (a
          // passive bonus the user doesn't manage directly).
          {
            symbol: "CELO",
            address: undefined,
            decimals: 18,
            displayDecimals: 4,
            balance: celoBal,
            label: t.descCELO,
            purpose: t.purposeCELO,
            canAdd: true,
            tint: "bg-black/[0.03] border-black/5",
          },
          {
            symbol: usdt.symbol,
            address: usdt.address,
            decimals: usdt.decimals,
            displayDecimals: 2,
            balance: usdtBal,
            label: t.descUSDT,
            purpose: t.purposeUSDT,
            canAdd: true,
            tint: "bg-teal/10 border-teal/20",
          },
          {
            symbol: COPM_TOKEN.symbol,
            address: COPM_TOKEN.address,
            decimals: COPM_TOKEN.decimals,
            displayDecimals: 0,
            balance: copmBal,
            label: t.descCOPm,
            purpose: t.purposeCOPm,
            canAdd: false,
            tint: "bg-yellow/20 border-yellow/40",
          },
        ]);
      } catch (e) {
        console.warn("wallet balances fetch failed:", e);
      }
    })();

    return () => {
      alive = false;
    };
  }, [address, publicClient, usdt.address, usdt.decimals, usdt.symbol, t]);

  if (!address) return null;

  return (
    <section className="rounded-3xl bg-white border border-black/5 p-5 shadow-[0_4px_0_0_rgba(0,0,0,0.04)] flex flex-col gap-4">
      <div>
        <h2 className="font-display text-xl tracking-wide">{t.wallet}</h2>
        <p className="text-xs text-muted mt-0.5">{t.walletSubtitle}</p>
      </div>

      {/* Address block. Order: context (what this is + network
          constraint), then the value, then the copy CTA. Constraint
          stays with the explanation so the user reads it BEFORE they
          copy+paste, not after. */}
      <div className="flex flex-col gap-2.5">
        <p className="text-sm text-muted leading-snug px-1">
          {t.addressHint}{" "}
          <span className="text-ink font-semibold">{t.networkWarning}</span>
        </p>
        <div className="px-3 py-3 rounded-xl bg-black/[0.03] font-mono text-sm break-all leading-relaxed">
          {address}
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-teal/10 hover:bg-teal/20 text-teal font-display tracking-wider uppercase text-sm py-2.5 transition"
        >
          <CopyIcon />
          {copied ? t.copied : t.copyAddress}
        </button>
      </div>

      {/* Per-token cards — each with big balance, human label, purpose copy,
          and context-specific actions (Add money / Send). Inside MiniPay
          we filter out CELO (fee abstraction = user never needs it) and
          COPm (sponsor campaign is wound down + not in MiniPay's
          supported-tokens list). Only USDT remains. */}
      <div className="flex flex-col gap-2">
        {balances.length === 0 && (
          <>
            <div className="h-20 bg-black/[0.03] animate-pulse rounded-xl" />
            <div className="h-20 bg-black/[0.03] animate-pulse rounded-xl" />
            <div className="h-20 bg-black/[0.03] animate-pulse rounded-xl" />
          </>
        )}
        {balances
          .filter(
            (b) =>
              !(inMiniPay && (b.symbol === "CELO" || b.symbol === "COPm")),
          )
          .map((b) => (
          <div
            key={b.symbol}
            className={`rounded-2xl border ${b.tint} px-4 py-3 flex flex-col gap-2`}
          >
            <div>
              <div className="text-ink leading-none flex items-baseline gap-1">
                <span className="font-display text-3xl tabular-nums">
                  {formatBalance(b.balance, b.decimals, b.displayDecimals)}
                </span>
                <span className="font-sans font-semibold text-base">
                  {b.symbol}
                </span>
              </div>
              <div className="text-xs font-display tracking-widest uppercase text-muted mt-1.5">
                {b.label}
              </div>
              <p className="text-sm text-muted leading-snug mt-1">
                {b.purpose}
              </p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              {b.canAdd && (
                <button
                  onClick={() =>
                    setTopUpFor(b.symbol as "USDT" | "CELO")
                  }
                  className="flex-1 rounded-lg bg-teal/10 hover:bg-teal/20 text-teal font-display tracking-wider uppercase text-sm py-2.5 transition"
                >
                  Add {b.symbol}
                </button>
              )}
              {b.address && b.balance > 0n && (
                <button
                  onClick={() => setSendFor(b)}
                  title={t.sendToAnotherWallet}
                  className="flex-1 rounded-lg bg-black/[0.04] hover:bg-black/[0.08] text-ink font-display tracking-wider uppercase text-sm py-2.5 transition"
                >
                  {t.send}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <NeedFundsModal
        open={!!topUpFor}
        token={topUpFor ?? "USDT"}
        walletAddress={address}
        onClose={() => setTopUpFor(null)}
      />

      {sendFor && (
        <SendModal
          token={sendFor}
          from={address}
          onClose={() => setSendFor(null)}
          onSent={() => {
            setSendFor(null);
            // optimistic: zero that token's balance locally until next refetch
            setBalances((prev) =>
              prev.map((b) =>
                b.symbol === sendFor.symbol ? { ...b, balance: 0n } : b,
              ),
            );
          }}
          chainId={chainId}
          switchChainAsync={switchChainAsync}
          writeContractAsync={writeContractAsync}
        />
      )}
    </section>
  );
}

function CopyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function SendModal({
  token,
  from,
  onClose,
  onSent,
  chainId,
  switchChainAsync,
  writeContractAsync,
}: {
  token: TokenBalance;
  from: `0x${string}`;
  onClose: () => void;
  onSent: () => void;
  chainId: number | undefined;
  switchChainAsync: (args: { chainId: number }) => Promise<unknown>;
  writeContractAsync: (args: Parameters<
    ReturnType<typeof useWriteContract>["writeContractAsync"]
  >[0]) => Promise<Hex>;
}) {
  const { t } = useLang();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `human` is the full-precision amount used by the Max button so the
  // user can transfer every last atom if they want; `humanShort` is what
  // we show next to "Available" so long-tail decimals don't take over
  // the modal.
  const human = formatUnits(token.balance, token.decimals);
  const humanShort = formatBalance(
    token.balance,
    token.decimals,
    token.displayDecimals,
  );
  const validTo = isAddress(to);
  const amountOk =
    amount !== "" && /^\d*\.?\d*$/.test(amount) && parseFloat(amount) > 0;

  async function handleSend() {
    setError(null);
    if (!validTo || !amountOk || !token.address) return;
    try {
      setSending(true);
      if (chainId !== ACTIVE_CHAIN.id) {
        await switchChainAsync({ chainId: ACTIVE_CHAIN.id });
      }
      const amountUnits = parseUnits(amount, token.decimals);
      if (amountUnits > token.balance) {
        setError("Amount exceeds balance");
        return;
      }
      await writeContractAsync({
        chainId: ACTIVE_CHAIN.id,
        address: token.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [to as `0x${string}`, amountUnits],
      });
      onSent();
    } catch (e) {
      setError(friendlyError(e, 140));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — same visual weight as the NeedFundsModal so the two
            sibling dialogs feel like one family. */}
        <div className="bg-teal/15 px-6 pt-6 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl tracking-wide leading-tight">
                {t.sendToken} {token.symbol}
              </h2>
              <p className="text-xs text-muted mt-1 leading-snug">
                {tpl(t.sendModalHint, { token: token.symbol })}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-xs font-display tracking-widest uppercase text-muted hover:text-ink shrink-0"
            >
              {t.close}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
          <div className="rounded-xl bg-black/[0.03] px-4 py-3">
            <div className="text-xs font-display tracking-widest uppercase text-muted">
              {t.available}
            </div>
            <div className="font-display text-3xl tabular-nums mt-0.5">
              {humanShort}{" "}
              <span className="font-sans text-base font-semibold">
                {token.symbol}
              </span>
            </div>
          </div>

          <div>
            <label className="text-xs font-display tracking-widest uppercase text-muted">
              {t.toAddress}
            </label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              placeholder="0x…"
              className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 font-mono text-sm focus:outline-none ${
                to === ""
                  ? "border-black/10"
                  : validTo
                  ? "border-teal"
                  : "border-red"
              }`}
            />
            {from.toLowerCase() === to.toLowerCase() && to !== "" && (
              <p className="text-xs text-red mt-1.5">
                {t.selfAddressWarning}
              </p>
            )}
            <p className="text-xs text-ink font-semibold mt-1.5 leading-snug">
              {t.sendNetworkNote}
            </p>
          </div>

          <div>
            <label className="text-xs font-display tracking-widest uppercase text-muted">
              {t.amount}
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                className="flex-1 rounded-xl border border-black/10 px-3 py-2.5 font-display text-2xl tabular-nums focus:outline-none focus:border-teal"
              />
              <button
                onClick={() => setAmount(human)}
                className="text-xs font-display tracking-widest uppercase px-4 rounded-xl bg-black/5 hover:bg-black/10"
              >
                {t.max}
              </button>
            </div>
          </div>

          <Button
            full
            disabled={!validTo || !amountOk || sending}
            onClick={handleSend}
          >
            {sending ? t.sending : `${t.sendToken} ${token.symbol}`}
          </Button>

          {error && (
            <p className="text-xs text-red text-center font-mono">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
