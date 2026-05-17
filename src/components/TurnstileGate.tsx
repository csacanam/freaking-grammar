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

  // Lock background scroll while the dialog is open so the page can't
  // be interacted with behind the modal — reinforces "you must do this
  // to continue."
  useEffect(() => {
    if (!siteKey) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [siteKey]);

  if (!siteKey) return null;

  // Modal overlay. A non-technical user landing on a sudden inline
  // captcha got confused (looked like a half-broken widget); centering
  // it in a proper dialog with a clear headline + bilingual explanation
  // makes it obvious that this is *the* thing they need to do right now
  // to unlock their account. Backdrop is non-dismissable (no click-to-
  // close, no ESC handler) — leaving without solving means no airdrop,
  // which is the failure mode this whole flow is trying to prevent.
  // Bilingual copy because we don't have the user's lang at this exact
  // moment in the Privy flow.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="turnstile-gate-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(10, 12, 16, 0.6)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 20,
          padding: "28px 24px",
          maxWidth: 380,
          width: "100%",
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.24)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          color: "#1a1a1a",
        }}
      >
        <div style={{ fontSize: 40, lineHeight: 1 }}>🎁</div>
        <h2
          id="turnstile-gate-title"
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            textAlign: "center",
            lineHeight: 1.3,
          }}
        >
          One quick check
          <br />
          <span style={{ color: "#666", fontWeight: 600 }}>
            Una verificación rápida
          </span>
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            textAlign: "center",
            lineHeight: 1.5,
            color: "#444",
          }}
        >
          Confirm you&apos;re human and we&apos;ll set up your free play
          right away.
          <br />
          <span style={{ color: "#888" }}>
            Confirma que eres humano y dejamos lista tu jugada gratis.
          </span>
        </p>
        <div
          ref={containerRef}
          style={{
            display: "flex",
            justifyContent: "center",
            minHeight: 70,
            width: "100%",
          }}
        />
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "#999",
            textAlign: "center",
          }}
        >
          This closes automatically when you&apos;re done · Se cierra solo
          al terminar
        </p>
      </div>
    </div>
  );
}
