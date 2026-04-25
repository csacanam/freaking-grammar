"use client";

// When a wallet connects (via Privy email or any external wallet),
// tell PostHog who the user is. Up to that point the visitor stays
// anonymous in PostHog. After identify, all subsequent events tie
// back to the wallet address so we can see per-user funnels and
// retention with concrete IDs.
//
// distinct_id is the lower-cased wallet address — same convention
// our supabase tables use, so cross-referencing PostHog data with
// supabase queries by address just works without normalisation.
//
// Email + lang are attached as person properties so we can filter
// audiences in PostHog ("show me Spanish-speaking users from CO who
// haven't paid in 7 days") without touching our DB.

import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useLang } from "@/lib/lang-provider";
import { posthog } from "@/lib/posthog-provider";

export function PostHogIdentifyBridge() {
  const { address } = useAccount();
  const { user } = usePrivy();
  const { uiLang } = useLang();
  const identifiedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!address) return;
    if (typeof window === "undefined") return;
    const lower = address.toLowerCase();
    if (identifiedFor.current === lower) return;

    const props: Record<string, unknown> = { ui_lang: uiLang };
    const email = user?.email?.address;
    if (email) props.email = email;
    if (user?.wallet?.walletClientType === "privy") {
      props.connector = "privy";
    } else {
      props.connector = "external";
    }

    posthog.identify(lower, props);
    identifiedFor.current = lower;
  }, [address, user?.email?.address, user?.wallet?.walletClientType, uiLang]);

  return null;
}
