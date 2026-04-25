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
    posthog.init(KEY, {
      api_host: HOST,
      capture_pageview: true,
      person_profiles: "identified_only",
      autocapture: false,
    });
    initialized.current = true;
  }, []);

  if (!KEY) return <>{children}</>;
  return <PHProvider client={posthog}>{children}</PHProvider>;
}

export { posthog };
