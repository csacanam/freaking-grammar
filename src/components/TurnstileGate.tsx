"use client";

import { useEffect, useRef, useState } from "react";

// Invisible Cloudflare Turnstile widget. Renders a hidden container,
// loads the Cloudflare script on first mount, gets challenged, and
// exposes the resulting token via the `onToken` callback. The
// "managed" execution mode is invisible to humans (no checkbox, no
// "I'm not a robot") — bots get the friction, humans don't see
// anything unless Cloudflare's risk score spikes.
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
        appearance: "interaction-only",
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

  // Hidden container — Turnstile draws inside it but the widget itself
  // stays invisible under "interaction-only" appearance.
  return <div ref={containerRef} aria-hidden style={{ display: "none" }} />;
}
