"use client";

import { useEffect, useRef, useState } from "react";
import { parseEther } from "viem";
import { useAccount, useBalance, useConnect } from "wagmi";
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

// Minimum CELO we want a non-MiniPay wallet to hold before we trust
// it to pay gas in CELO. A claimMultiple costs ~0.001-0.005 CELO; the
// 0.01 floor leaves comfortable headroom and matches the welcome-gas
// airdrop size.
const GAS_FLOOR_CELO = parseEther("0.01");

// CIP-64 fee abstraction overrides for any user-facing writeContract /
// sendTransaction call. Spread the return value into the tx params.
//
// Policy:
//   - MiniPay: always pay gas in USDT (users never hold CELO there).
//   - Other wallets (Privy embedded, MetaMask, Farcaster, …): use USDT
//     gas only when the wallet's CELO balance is below GAS_FLOOR_CELO.
//     This matters most for Privy embedded — welcome-gas seeds ~0.01
//     CELO which gets eaten by a few plays, leaving the user unable
//     to claim their prize because the claim tx had no CELO to pay
//     gas with. If the wallet does have CELO (external user who self-
//     funded), we let them pay in CELO since CIP-64 carries an adapter
//     fee that makes USDT gas slightly more expensive.
//
// Why USDT specifically: it's the only token nerdos.fun charges in, so
// any user with a win to claim has USDT in their wallet by construction.
//
// Returns a typed object literal that's safe to spread into viem's
// writeContract / sendTransaction args even on chains without an
// adapter — `feeCurrency: undefined` is a no-op.
export function useTxOverrides(): { feeCurrency?: `0x${string}` } {
  const inMiniPay = useIsMiniPay();
  const { address } = useAccount();
  const { data: celoBalance } = useBalance({
    address,
    chainId: ACTIVE_CHAIN.id,
  });
  const fc = STABLECOIN[ACTIVE_CHAIN.id]?.feeCurrency;
  if (!fc) return {};
  if (inMiniPay) return { feeCurrency: fc };
  // Until the balance loads, default to CIP-64 — safer to slightly
  // overpay gas in USDT than to broadcast a tx that may revert for
  // lack of CELO.
  if (!celoBalance || celoBalance.value < GAS_FLOOR_CELO) {
    return { feeCurrency: fc };
  }
  return {};
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
