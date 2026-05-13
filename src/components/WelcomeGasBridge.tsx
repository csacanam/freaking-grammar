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
// NEXT_PUBLIC_TURNSTILE_SITE_KEY is configured. The widget renders
// visibly ("I'm not a robot" checkbox); user clicks once, gets a
// token, the airdrop fires. We tried invisible / interaction-only
// first but Cloudflare's risk model rejected too many legitimate
// users (mobile WebViews, residential LATAM IPs) and each rejection
// turned into a manual refund. Visible mode trades ~2s of friction
// for ~zero false positives. Without the env var the gate no-ops
// and the request fires immediately, so dev environments don't need
// captcha set up to test.
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

    // When Turnstile is enabled, wait for the user to solve the
    // visible widget. The effect re-runs once setTurnstileToken
    // resolves so the airdrop fires immediately after the click.
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

  // Only mount the widget when it's actually needed: a Privy-embedded
  // wallet is connected and we don't have a token yet. Without these
  // gates the visible captcha would render globally on every page for
  // every visitor, including unauthenticated ones — confusing and
  // unnecessary. Once the user solves it (or if the bridge already
  // fired for this address), unmount.
  const wallet = user?.wallet;
  const needsCaptcha =
    turnstileRequired &&
    ready &&
    authenticated &&
    wallet?.walletClientType === "privy" &&
    !!wallet?.address &&
    firedRef.current !== wallet.address.toLowerCase() &&
    !turnstileToken;

  return needsCaptcha ? <TurnstileGate onToken={onToken} /> : null;
}
