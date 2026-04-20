"use client";

import { useEffect } from "react";
import Image from "next/image";
import { fmtUSD } from "@/lib/format";

// Shown when a paid play is attempted but the wallet's USDT balance is below
// the entry fee. Gives the user actionable paths to get USDT on Celo rather
// than a cryptic "ERC20 transfer" error from the chain.
export function NeedUsdtModal({
  open,
  balanceUSD,
  needUSD,
  walletAddress,
  onClose,
}: {
  open: boolean;
  balanceUSD: number;
  needUSD: number;
  walletAddress?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-yellow/40 px-6 pt-6 pb-5 flex items-center gap-3">
          <Image src="/mascot.png" alt="" width={48} height={48} />
          <div>
            <h2 className="font-display text-2xl tracking-wide leading-tight">
              Not enough USDT
            </h2>
            <p className="text-[11px] font-mono text-muted mt-1">
              Celo · USDT needed
            </p>
          </div>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-black/[0.04] px-3 py-2">
              <div className="text-[10px] font-display tracking-widest uppercase text-muted">
                You have
              </div>
              <div className="font-display text-2xl tabular-nums mt-0.5">
                {fmtUSD(balanceUSD)}
              </div>
            </div>
            <div className="rounded-xl bg-teal/15 px-3 py-2">
              <div className="text-[10px] font-display tracking-widest uppercase text-muted">
                You need
              </div>
              <div className="font-display text-2xl tabular-nums mt-0.5">
                {fmtUSD(needUSD)}
              </div>
            </div>
          </div>

          <p className="text-sm text-muted leading-snug">
            Top up USDT on the <span className="font-display">Celo</span>{" "}
            network to the wallet below, then try again.
          </p>

          {walletAddress && (
            <code className="block text-xs font-mono bg-black/[0.04] rounded-lg px-3 py-2 break-all">
              {walletAddress}
            </code>
          )}

          <div className="flex flex-col gap-2">
            <a
              href="https://app.squidrouter.com/?chains=1%2C42220&tokens=0xdAC17F958D2ee523a2206206994597C13D831ec7%2C0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between px-4 py-3 rounded-xl bg-teal/10 hover:bg-teal/20 transition"
            >
              <div>
                <div className="font-display text-sm tracking-wider uppercase">
                  Bridge → USDT on Celo
                </div>
                <div className="text-[11px] text-muted">
                  From Ethereum, Base, Polygon… via Squid
                </div>
              </div>
              <span className="text-teal text-xl">↗</span>
            </a>
            <a
              href="https://app.uniswap.org/swap?chain=celo&inputCurrency=0x471EcE3750Da237f93B8E339c536989b8978a438&outputCurrency=0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between px-4 py-3 rounded-xl bg-purple/10 hover:bg-purple/20 transition"
            >
              <div>
                <div className="font-display text-sm tracking-wider uppercase">
                  Swap CELO → USDT
                </div>
                <div className="text-[11px] text-muted">On Uniswap (Celo)</div>
              </div>
              <span className="text-purple text-xl">↗</span>
            </a>
            <div className="text-[11px] text-muted leading-snug text-center pt-2">
              Or withdraw USDT via the{" "}
              <span className="font-display">Celo</span> network from any
              exchange (Binance, Coinbase, OKX…).
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 text-xs font-display tracking-widest uppercase text-muted border-t border-black/5 hover:text-ink"
        >
          Close
        </button>
      </div>
    </div>
  );
}
