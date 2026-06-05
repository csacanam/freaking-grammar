"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect } from "wagmi";

// MiniPay is Opera Mini's stablecoin wallet on Celo. It injects window.ethereum
// and expects dApps to auto-connect without showing a "Connect Wallet" button.
// https://docs.celo.org/build-on-celo/build-on-minipay
//
// Dev simulation: in non-production builds, `?minipay=1` on the URL flips
// the detection to true so you can test MiniPay-only branches (hidden
// CELO row, Deposit deeplink modal, "Connecting…" placeholder, etc.)
// without needing the real MiniPay app + an ngrok tunnel. The flag is
// gated to `process.env.NODE_ENV !== "production"` so it never fires
// on Vercel.
export function isMiniPay(): boolean {
  if (typeof window === "undefined") return false;
  if (
    process.env.NODE_ENV !== "production" &&
    new URLSearchParams(window.location.search).get("minipay") === "1"
  ) {
    return true;
  }
  const eth = (window as { ethereum?: { isMiniPay?: boolean } }).ethereum;
  return Boolean(eth?.isMiniPay);
}

// Hook variant of isMiniPay() that's safe to use anywhere a component
// needs to branch on "are we inside MiniPay". Returns false on the
// server and first paint (so SSR and the initial client render agree)
// and then re-renders true once mounted if window.ethereum.isMiniPay
// is set. Use this — never read isMiniPay() inline during render — to
// avoid hydration-mismatch warnings.
export function useIsMiniPay(): boolean {
  const [inMiniPay, setInMiniPay] = useState(false);
  useEffect(() => {
    setInMiniPay(isMiniPay());
  }, []);
  return inMiniPay;
}

export function useMiniPayAutoConnect(): void {
  const { isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const triedRef = useRef(false);

  useEffect(() => {
    if (triedRef.current || isConnected) return;
    if (!isMiniPay()) return;
    const injected = connectors.find((c) => c.type === "injected");
    if (!injected) return;
    triedRef.current = true;
    connect({ connector: injected });
  }, [connectors, connect, isConnected]);
}
