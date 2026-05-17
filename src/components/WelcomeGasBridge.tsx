"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useLang } from "@/lib/lang-provider";
import { TurnstileGate } from "@/components/TurnstileGate";

// When the Privy user finishes linking an embedded wallet, fire a request
// to /api/welcome-gas so the wallet gets ~0.1 CELO for gas before they try
// their first play. The endpoint is idempotent so multiple fires are safe.
// No-ops for self-custody wallets (MetaMask, MiniPay, Farcaster, etc.) —
// those users fund their own gas.
//
// Anti-Sybil: the airdrop step is gated on a Cloudflare Turnstile token
// when NEXT_PUBLIC_TURNSTILE_SITE_KEY is configured. We use a two-phase
// flow so returning users never see the captcha:
//
//   1. Preflight call (no token). The server checks welcome_airdrops
//      idempotency BEFORE the captcha — returning users hit 200 and we
//      stop. Brand-new addresses come back 401 "captcha-required".
//   2. If preflight asks for a captcha, mount TurnstileGate (visible
//      dialog). User solves it, we re-call /api/welcome-gas with the
//      token attached, the server verifies and sends the airdrop.
//
// Visible widget instead of invisible/interaction-only because
// Cloudflare's risk model rejected too many legitimate users (mobile
// WebViews, residential LATAM IPs) and each rejection turned into a
// manual refund. Visible mode trades ~2s of friction for ~zero false
// positives.
//
// Without NEXT_PUBLIC_TURNSTILE_SITE_KEY the gate doesn't render and the
// preflight just succeeds directly (server's verifyTurnstile no-ops too),
// so dev environments don't need captcha set up to test.

type Phase = "idle" | "preflight" | "needs-captcha" | "submitting" | "done";

export function WelcomeGasBridge() {
  const { ready, authenticated, user } = usePrivy();
  const { uiLang } = useLang();
  const phaseRef = useRef<{ addr: string; phase: Phase } | null>(null);
  const [needsCaptcha, setNeedsCaptcha] = useState(false);

  const wallet = user?.wallet;
  const addr =
    ready && authenticated && wallet?.walletClientType === "privy"
      ? wallet.address?.toLowerCase() ?? null
      : null;
  const email = user?.email?.address ?? null;

  const fireAirdrop = useCallback(
    async (turnstileToken: string | null) => {
      if (!addr) return;
      const res = await fetch("/api/welcome-gas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: addr,
          email,
          lang: uiLang,
          turnstileToken,
        }),
      });

      // 401 means the server wants a captcha token. Surface the dialog;
      // the user solves it; onToken() below re-enters this function.
      if (res.status === 401) {
        const body = await res.json().catch(() => ({}));
        if ((body as { error?: string }).error === "captcha-required") {
          phaseRef.current = { addr, phase: "needs-captcha" };
          setNeedsCaptcha(true);
          return;
        }
      }

      // Any other terminal response (200, 403, 500, …) ends this round.
      // 403 = real Turnstile rejection; the server has already telegrammed
      // us about it, so there's nothing useful for the bridge to do.
      phaseRef.current = { addr, phase: "done" };
      setNeedsCaptcha(false);
    },
    [addr, email, uiLang],
  );

  // Step 1: preflight on mount. Runs once per address per page load. If
  // the server's idempotency check matches, we're done with no UI.
  useEffect(() => {
    if (!addr) return;
    if (phaseRef.current?.addr === addr) return; // already handled this round
    phaseRef.current = { addr, phase: "preflight" };
    fireAirdrop(null).catch((e) => {
      console.warn("welcome-gas preflight failed:", e);
      // Reset so a later focus/render retries — better than leaving the
      // user permanently stuck in "preflight" if a transient network
      // error swallowed the first attempt.
      phaseRef.current = null;
    });
  }, [addr, fireAirdrop]);

  // Step 2: when the user solves the captcha, re-call with the token.
  const onToken = useCallback(
    (turnstileToken: string) => {
      if (!addr) return;
      phaseRef.current = { addr, phase: "submitting" };
      setNeedsCaptcha(false); // unmount the dialog optimistically
      fireAirdrop(turnstileToken).catch((e) => {
        console.warn("welcome-gas submit failed:", e);
        // Let the user retry — re-open the dialog so they can solve again.
        phaseRef.current = { addr, phase: "needs-captcha" };
        setNeedsCaptcha(true);
      });
    },
    [addr, fireAirdrop],
  );

  return needsCaptcha ? <TurnstileGate onToken={onToken} /> : null;
}
