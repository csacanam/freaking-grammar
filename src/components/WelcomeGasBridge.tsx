"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useLang } from "@/lib/lang-provider";
import { TurnstileGate } from "@/components/TurnstileGate";

// When the Privy user finishes linking an embedded wallet, fire a one-shot
// request to /api/welcome-gas so the wallet gets ~0.1 CELO for gas before
// they try their first play. The endpoint is idempotent so multiple fires
// are safe. No-ops for self-custody wallets (MetaMask, MiniPay, Farcaster,
// etc.) — those users fund their own gas.
//
// Anti-Sybil: the request is gated on a Cloudflare Turnstile token when
// NEXT_PUBLIC_TURNSTILE_SITE_KEY is configured. Turnstile challenges
// happen invisibly; humans don't see anything, bots get rejected at
// /api/welcome-gas. Without the env var the gate no-ops and the
// request fires as before, so dev environments don't need captcha
// set up to test.
export function WelcomeGasBridge() {
  const { ready, authenticated, user } = usePrivy();
  const { uiLang } = useLang();
  const firedRef = useRef<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRequired = Boolean(
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  );

  const onToken = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

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

    // When Turnstile is enabled, wait for the invisible challenge to
    // produce a token before firing. The widget settles in <1s for a
    // legitimate browser; this effect re-runs once setTurnstileToken
    // resolves so the airdrop fires shortly after.
    if (turnstileRequired && !turnstileToken) return;

    firedRef.current = addr;

    const email = user.email?.address ?? null;
    fetch("/api/welcome-gas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // uiLang is the interface language the user is reading when Privy
      // provisions the wallet — our best no-prompt signal for which
      // language their future notifications (daily email, etc) should
      // land in.
      body: JSON.stringify({
        address: addr,
        email,
        lang: uiLang,
        turnstileToken,
      }),
    }).catch((e) => {
      console.warn("welcome-gas request failed:", e);
      // Reset so we retry on a later render / refocus.
      firedRef.current = null;
    });
  }, [ready, authenticated, user, uiLang, turnstileRequired, turnstileToken]);

  return <TurnstileGate onToken={onToken} />;
}
