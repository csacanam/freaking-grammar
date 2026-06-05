"use client";

// Minimal PostHog wiring for client-side analytics. Lives in its own
// module so other components can `import { posthog }` and fire events
// without re-initialising. The wrapper is a no-op when
// NEXT_PUBLIC_POSTHOG_KEY isn't set, so local dev / preview deploys
// without the env var still render fine.
//
// What we get for free once initialised:
//   - automatic pageviews (capture_pageview: true)
//   - automatic geoip (country, city) on every event
//   - automatic device / browser / OS / referrer tagging
//   - per-session id + duration
// Custom events get fired explicitly via `posthog.capture(...)` from
// the relevant components (e.g. game page captures play_started /
// play_finished).
//
// `person_profiles: 'identified_only'` keeps anonymous visitors as
// just events (cheap, privacy-friendly) and only spins up a person
// profile when we explicitly call posthog.identify(walletAddress).

import { useEffect, useRef, type ReactNode } from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export function PostHogProvider({ children }: { children: ReactNode }) {
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    if (!KEY || typeof window === "undefined") return;
    // Defer the PostHog init off the critical path. posthog.init() pulls
    // in autocapture/session-recording lazy modules and burns ~150ms of
    // main-thread time on emulated Moto G Power, which was visibly
    // hurting our PageSpeed LCP/TBT. Capturing analytics 50-300ms later
    // than first paint is invisible to users; blocking first paint
    // isn't.
    //
    // requestIdleCallback runs when the browser is otherwise idle.
    // Safari doesn't ship it yet; fall back to a 0-ms setTimeout so the
    // init at least slides off the current microtask. Either way: never
    // synchronously during first paint.
    const run = () => {
      posthog.init(KEY, {
        api_host: HOST,
        capture_pageview: true,
        person_profiles: "identified_only",
        autocapture: false,
      });
      initialized.current = true;
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(run, { timeout: 3000 });
    } else {
      setTimeout(run, 0);
    }
  }, []);

  if (!KEY) return <>{children}</>;
  return <PHProvider client={posthog}>{children}</PHProvider>;
}

export { posthog };
