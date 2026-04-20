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
  // Close on Escape
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
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl p-5 max-w-md w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl mb-3 text-center">
          Choose a wallet
        </h2>
        <div className="flex flex-col gap-2">
          {display.length === 0 && (
            <p className="text-sm text-muted text-center py-4">
              No wallet detected. Install MetaMask, Rabby, Phantom, or another browser wallet.
            </p>
          )}
          {display.map((c) => (
            <button
              key={c.uid}
              onClick={() => onSelect(c)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-black/5 hover:bg-black/10 active:bg-black/15 transition text-left"
            >
              {c.icon ? (
                <Image
                  src={c.icon}
                  alt=""
                  width={32}
                  height={32}
                  className="rounded-md"
                  unoptimized
                />
              ) : (
                <div className="w-8 h-8 rounded-md bg-teal/20 flex items-center justify-center font-display text-ink text-sm">
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <span className="font-display text-lg">{c.name}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full text-xs font-display tracking-widest uppercase text-muted"
        >
          cancel
        </button>
      </div>
    </div>
  );
}
