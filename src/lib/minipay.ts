"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { ACTIVE_CHAIN, STABLECOIN } from "./chain";

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

// CIP-64 fee abstraction overrides for any user-facing writeContract /
// sendTransaction call. Spread the return value into the tx params so
// MiniPay users (who hide CELO) can pay gas in the app's stablecoin
// instead. Outside MiniPay we omit feeCurrency — the user's wallet
// (Privy embedded, MetaMask, Farcaster, …) is expected to have CELO,
// either airdropped by welcome-gas or self-funded.
//
// Why USDT specifically: it's the only token nerdos.fun charges in, so
// any user who has played at least once paid in USDT. Brand-new MiniPay
// users without USDT will hit the NeedFundsModal which deeplinks them
// to MiniPay's Add Cash screen. Picking the user's highest-balance
// stablecoin dynamically (celopedia minipay-templates §6) is a future
// optimization — fine for now.
//
// Returns a typed object literal that's safe to spread into viem's
// writeContract / sendTransaction args even on chains without an
// adapter — `feeCurrency: undefined` is a no-op.
export function useTxOverrides(): { feeCurrency?: `0x${string}` } {
  const inMiniPay = useIsMiniPay();
  if (!inMiniPay) return {};
  const fc = STABLECOIN[ACTIVE_CHAIN.id]?.feeCurrency;
  return fc ? { feeCurrency: fc } : {};
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
