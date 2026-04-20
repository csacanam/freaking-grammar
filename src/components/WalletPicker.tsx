"use client";

import { useEffect, useMemo } from "react";
import Image from "next/image";
import type { Connector } from "wagmi";

export function WalletPicker({
  open,
  connectors,
  onSelect,
  onClose,
}: {
  open: boolean;
  connectors: readonly Connector[];
  onSelect: (c: Connector) => void;
  onClose: () => void;
}) {
  // Hide the bare "Injected" catch-all when EIP-6963 has announced specific
  // wallets (MetaMask, Rabby, Phantom, etc.). Keeps the list clean.
  const display = useMemo(() => {
    const hasSpecific = connectors.some(
      (c) =>
        c.type === "injected" &&
        c.id !== "injected" &&
        c.name !== "Injected",
    );
    if (!hasSpecific) return connectors;
    return connectors.filter(
      (c) =>
        !(c.type === "injected" && (c.id === "injected" || c.name === "Injected")),
    );
  }, [connectors]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while the modal is open so the page behind doesn't
    // scroll with gestures on mobile.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-3">
          <h2 className="font-display text-2xl text-center leading-tight">
            Choose a wallet
          </h2>
          <p className="text-xs text-muted text-center mt-1 font-mono">
            You'll sign one tx to play · Celo network
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          <div className="flex flex-col gap-2">
            {display.length === 0 && (
              <p className="text-sm text-muted text-center py-6 leading-snug">
                No wallet detected.
                <br />
                Install MetaMask, Rabby, Phantom, or another browser wallet.
              </p>
            )}
            {display.map((c) => (
              <button
                key={c.uid}
                onClick={() => onSelect(c)}
                className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-black/[0.04] hover:bg-black/[0.08] active:bg-black/[0.12] transition text-left min-h-[56px]"
              >
                {c.icon ? (
                  <Image
                    src={c.icon}
                    alt=""
                    width={36}
                    height={36}
                    className="rounded-lg shrink-0"
                    unoptimized
                  />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-teal/20 flex items-center justify-center font-display text-ink text-base shrink-0">
                    {c.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <span className="font-display text-lg truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-4 text-xs font-display tracking-widest uppercase text-muted border-t border-black/5 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
