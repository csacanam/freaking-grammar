"use client";

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";

// When the Privy user finishes linking an embedded wallet, fire a one-shot
// request to /api/welcome-gas so the wallet gets ~0.1 CELO for gas before
// they try their first play. The endpoint is idempotent so multiple fires
// are safe. No-ops for self-custody wallets (MetaMask, MiniPay, Farcaster,
// etc.) — those users fund their own gas.
export function WelcomeGasBridge() {
  const { ready, authenticated, user } = usePrivy();
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    const wallet = user.wallet;
    // walletClientType === 'privy' means Privy provisioned this embedded
    // wallet. Other values ('metamask', 'coinbase_wallet', etc.) mean the
    // user brought their own — no airdrop in that case.
    if (!wallet || wallet.walletClientType !== "privy") return;
    const addr = wallet.address?.toLowerCase();
    if (!addr) return;
    if (firedRef.current === addr) return;
    firedRef.current = addr;

    const email = user.email?.address ?? null;
    fetch("/api/welcome-gas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addr, email }),
    }).catch((e) => {
      console.warn("welcome-gas request failed:", e);
      // Reset so we retry on a later render / refocus.
      firedRef.current = null;
    });
  }, [ready, authenticated, user]);

  return null;
}
