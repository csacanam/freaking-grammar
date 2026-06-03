"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect } from "wagmi";

// MiniPay is Opera Mini's stablecoin wallet on Celo. It injects window.ethereum
// and expects dApps to auto-connect without showing a "Connect Wallet" button.
// https://docs.celo.org/build-on-celo/build-on-minipay
export function isMiniPay(): boolean {
  if (typeof window === "undefined") return false;
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
