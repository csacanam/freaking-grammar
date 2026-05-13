"use client";

import { useEffect, useRef, useState } from "react";

// Visible Cloudflare Turnstile widget. Renders the standard
// "I'm not a robot" challenge inline, exposes the token via
// `onToken` once the user passes. Visible mode (`appearance: "always"`)
// is the right default after we found the invisible / interaction-only
// mode rejecting too many legitimate users — mobile WebViews, residential
// LATAM IPs, reduced-fingerprint Chrome on Android. Each rejection cost
// us a manual refund, so the small UX cost of an explicit checkbox is
// the better trade.
//
// If NEXT_PUBLIC_TURNSTILE_SITE_KEY isn't configured, the component
// no-ops and onToken is never called — the rest of the app keeps
// working without captcha, useful for dev and the first prod boot
// before the keys are in Vercel.

// Minimal local types — using `declare global` collided with the
// types from @cloudflare/turnstile that Privy's dependency tree
// already pulls in. Type-cast through `unknown` at the call sites
// instead.
type TurnstileAPI = {
  render: (
    container: HTMLElement,
    params: {
      sitekey: string;
      callback?: (token: string) => void;
      appearance?: "always" | "execute" | "interaction-only";
    },
  ) => string;
  remove: (widgetId?: string) => void;
};

function getTurnstile(): TurnstileAPI | undefined {
  return (window as unknown as { turnstile?: TurnstileAPI }).turnstile;
}

export function TurnstileGate({
  onToken,
}: {
  onToken: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [siteKey] = useState(
    () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
  );

  useEffect(() => {
    if (!siteKey) return; // no key configured — skip
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;

    let cancelled = false;

    const renderWidget = () => {
      const api = getTurnstile();
      if (cancelled || !api || !containerRef.current) return;
      if (widgetIdRef.current) return; // already rendered
      const id = api.render(containerRef.current, {
        sitekey: siteKey,
        appearance: "always",
        callback: (token: string) => {
          if (!cancelled) onToken(token);
        },
      });
      widgetIdRef.current = id;
    };

    if (getTurnstile()) {
      renderWidget();
    } else {
      // Load the Turnstile script once. Cloudflare exposes
      // `onTurnstileLoad` as the canonical "ready" hook; we wrap any
      // previously-registered callback so multiple components on the
      // same page each get notified.
      const w = window as unknown as { onTurnstileLoad?: () => void };
      const prev = w.onTurnstileLoad;
      w.onTurnstileLoad = () => {
        prev?.();
        renderWidget();
      };
      if (!document.querySelector("script[data-turnstile]")) {
        const s = document.createElement("script");
        s.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
        s.async = true;
        s.defer = true;
        s.dataset.turnstile = "1";
        document.head.appendChild(s);
      }
    }

    return () => {
      cancelled = true;
      const id = widgetIdRef.current;
      const api = getTurnstile();
      if (id && api) {
        try {
          api.remove(id);
        } catch {
          /* widget already gone */
        }
      }
      widgetIdRef.current = null;
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;

  // Centered card with a short label so the user understands why this
  // checkbox suddenly appeared. Bilingual single line — same rationale
  // as the apology email: we don't have lang for first-time users at
  // this exact point in the flow, so EN + ES in one line covers
  // everyone without a guess.
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        margin: "20px auto",
        padding: "16px",
        maxWidth: 360,
        background: "#f8f8f8",
        border: "1px solid #eeeaea",
        borderRadius: 12,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 14,
          color: "#1a1a1a",
          textAlign: "center",
          lineHeight: 1.4,
        }}
      >
        🎁 One quick check to unlock your free play
        <br />
        <span style={{ color: "#666" }}>
          Una verificación rápida para tu jugada gratis
        </span>
      </p>
      <div ref={containerRef} />
    </div>
  );
}
