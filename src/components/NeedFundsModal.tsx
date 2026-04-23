"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useLang } from "@/lib/lang-provider";
import { tpl } from "@/lib/i18n";

// Shown when an action can't proceed because the wallet is short on USDT
// (paid play) or CELO (gas), AND from the /you → Wallet "Add money" button
// where there's no low-balance trigger yet. Mode changes the header copy
// from alarming ("Not enough X") to neutral ("Add X to your wallet"); the
// body is the same three-option structure regardless.
type Token = "USDT" | "CELO";
type Mode = "insufficient" | "add";

// Squid Router deep-links — destination is the Celo token we want.
const SQUID_BRIDGE: Record<Token, string> = {
  USDT: "https://app.squidrouter.com/?chains=1%2C42220&tokens=0xdAC17F958D2ee523a2206206994597C13D831ec7%2C0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
  CELO: "https://app.squidrouter.com/?chains=1%2C42220&tokens=0x0000000000000000000000000000000000000000%2C0x471EcE3750Da237f93B8E339c536989b8978a438",
};

// Uniswap on Celo — swap the other token into the one you need.
const UNISWAP_SWAP: Record<Token, string> = {
  USDT: "https://app.uniswap.org/swap?chain=celo&inputCurrency=0x471EcE3750Da237f93B8E339c536989b8978a438&outputCurrency=0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
  CELO: "https://app.uniswap.org/swap?chain=celo&inputCurrency=0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e&outputCurrency=0x471EcE3750Da237f93B8E339c536989b8978a438",
};

export function NeedFundsModal({
  open,
  token,
  balance,
  need,
  walletAddress,
  mode = "add",
  onClose,
}: {
  open: boolean;
  token: Token;
  balance?: string;
  need?: string;
  walletAddress?: string;
  mode?: Mode;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isInsufficient = mode === "insufficient";
  const title = isInsufficient
    ? token === "USDT"
      ? t.notEnoughUSDT
      : t.notEnoughCELO
    : tpl(t.addTokenTitle, { token });
  const blurb = token === "USDT" ? t.blurbUSDT : t.blurbCELO;
  const swapLabel = token === "USDT" ? t.swapCeloUsdt : t.swapUsdtCelo;
  const swapHint = token === "USDT" ? t.swapHintUSDT : t.swapHintCELO;
  const showBalances = isInsufficient && balance !== undefined && need !== undefined;

  async function copyAddr() {
    if (!walletAddress) return;
    await navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
        {/* Header */}
        <div className="bg-yellow/40 px-6 pt-6 pb-5 flex items-center gap-3">
          <Image src="/mascot.png" alt="" width={48} height={48} />
          <div>
            <h2 className="font-display text-2xl tracking-wide leading-tight">
              {title}
            </h2>
            <p className="text-[11px] text-muted mt-1 leading-snug">{blurb}</p>
          </div>
        </div>

        {/* Body — scrollable. Balance grid only in "insufficient" mode so
            the "add" entry point isn't cluttered with zero-state metrics.
            Thin dividers between options keep them visually separated so the
            three paths read as distinct alternatives, not one long column. */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
          {showBalances && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-black/[0.04] px-3 py-2">
                <div className="text-[10px] font-display tracking-widest uppercase text-muted">
                  {t.youHave}
                </div>
                <div className="font-display text-2xl tabular-nums mt-0.5">
                  {balance}
                </div>
              </div>
              <div className="rounded-xl bg-teal/15 px-3 py-2">
                <div className="text-[10px] font-display tracking-widest uppercase text-muted">
                  {t.youNeed}
                </div>
                <div className="font-display text-2xl tabular-nums mt-0.5">
                  {need}
                </div>
              </div>
            </div>
          )}

          {/* Option 1 — Receive at your address */}
          {walletAddress && (
            <Option
              index="1"
              title={t.receiveTitle}
              hint={
                <>
                  {tpl(t.receiveHint, { token })}{" "}
                  <span className="text-ink font-semibold">
                    {t.networkWarning}
                  </span>
                </>
              }
            >
              <button
                onClick={copyAddr}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-yellow/20 hover:bg-yellow/30 transition text-left"
              >
                <div>
                  <div className="font-display text-sm tracking-wider uppercase">
                    {copied ? t.copied : t.copyAddress}
                  </div>
                  <div className="text-[11px] font-mono text-muted mt-0.5">
                    {`${walletAddress.slice(0, 10)}…${walletAddress.slice(-6)}`}
                  </div>
                </div>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="text-ink/70 shrink-0"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </Option>
          )}

          <div className="h-px bg-black/10" />

          {/* Option 2 — Bridge from another chain */}
          <Option
            index="2"
            title={t.bridgeTitle}
            hint={t.bridgeHint}
          >
            <a
              href={SQUID_BRIDGE[token]}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between px-4 py-3 rounded-xl bg-teal/10 hover:bg-teal/20 transition"
            >
              <div className="font-display text-sm tracking-wider uppercase">
                {tpl(t.bridgeTo, { token })}
              </div>
              <span className="text-teal text-xl">↗</span>
            </a>
          </Option>

          <div className="h-px bg-black/10" />

          {/* Option 3 — Swap on Celo */}
          <Option
            index="3"
            title={t.swapTitle}
            hint={swapHint}
          >
            <a
              href={UNISWAP_SWAP[token]}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between px-4 py-3 rounded-xl bg-purple/10 hover:bg-purple/20 transition"
            >
              <div className="font-display text-sm tracking-wider uppercase">
                {swapLabel}
              </div>
              <span className="text-purple text-xl">↗</span>
            </a>
          </Option>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 text-xs font-display tracking-widest uppercase text-muted border-t border-black/5 hover:text-ink"
        >
          {t.close}
        </button>
      </div>
    </div>
  );
}

// Each option is a self-contained card with its own label, blurb, and
// action. Separating them visually avoids the "wall of links" look the
// old modal had.
function Option({
  index,
  title,
  hint,
  children,
}: {
  index: string;
  title: string;
  hint: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-xs tracking-widest uppercase text-muted">
          {index}
        </span>
        <span className="font-display text-base tracking-wide">{title}</span>
      </div>
      <p className="text-[11px] text-muted leading-snug">{hint}</p>
      {children}
    </div>
  );
}
