"use client";

import { WagmiProvider } from "@privy-io/wagmi";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { wagmiConfig } from "./wagmi";
import { LangProvider } from "./lang-provider";
import { useMiniPayAutoConnect } from "./minipay";
import { WelcomeGasBridge } from "@/components/WelcomeGasBridge";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";

// Must live inside WagmiProvider so the wagmi hooks have a client.
function MiniPayBridge() {
  useMiniPayAutoConnect();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());

  // Dismiss the Farcaster splash screen once the mini-app has hydrated. Safe
  // to call outside mini-app contexts — it no-ops if the host SDK isn't there.
  useEffect(() => {
    (async () => {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        await sdk.actions.ready();
      } catch {
        // not inside Farcaster — ignore
      }
    })();
  }, []);

  // Diagnostic: dump every EIP-6963 provider announcement.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const e = event as CustomEvent<{
        info?: {
          uuid?: string;
          rdns?: string;
          name?: string;
          icon?: unknown;
        };
      }>;
      const info = e.detail?.info;
      if (!info) return;
      const icon = info.icon;
      const iconType = typeof icon;
      console.log("[EIP-6963]", {
        uuid: info.uuid,
        rdns: info.rdns,
        name: info.name,
        iconType,
        iconPreview:
          iconType === "string"
            ? (icon as string).slice(0, 80)
            : icon,
      });
    };
    window.addEventListener("eip6963:announceProvider", handler);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () =>
      window.removeEventListener("eip6963:announceProvider", handler);
  }, []);

  // Workaround for a bug in @privy-io/wagmi 4.0.5: the "Privy Wallet"
  // connector it injects after an embedded-wallet login has `icon` set to
  // a React component (function), but Privy's own SDK iterates all wagmi
  // connectors and calls `icon.replace(...)` assuming strings — which
  // crashes the whole post-login render with:
  //   "e.icon?.replace is not a function"
  //
  // We can't prevent Privy from registering the connector, and our
  // constructor-time `withStringIcon` doesn't see it because it's added
  // internally, not via our `connectors: [...]` array. Instead we patch
  // `Array.prototype.filter` to normalise any Privy-Wallet-like item's
  // icon to an empty string right before the filter runs. Harmless for
  // other arrays; narrow match on `id.startsWith('io.privy.wallet')` so
  // we don't mutate unrelated objects.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { __fgPrivyIconPatched?: boolean };
    if (w.__fgPrivyIconPatched) return;
    w.__fgPrivyIconPatched = true;
    const orig = Array.prototype.filter;
    Array.prototype.filter = function <T>(
      this: T[],
      fn: (v: T, i: number, a: T[]) => boolean,
      ctx?: unknown,
    ): T[] {
      for (const v of this) {
        const o = v as unknown as { id?: unknown; icon?: unknown };
        if (
          o &&
          typeof o === "object" &&
          typeof o.id === "string" &&
          o.id.startsWith("io.privy.wallet") &&
          typeof o.icon !== "string"
        ) {
          o.icon = "";
        }
      }
      return orig.call(this, fn, ctx) as T[];
    } as typeof Array.prototype.filter;
  }, []);

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        embeddedWallets: {
          showWalletUIs: false,
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
          solana: {
            createOnLogin: "off",
          },
        },
      }}
    >
      <QueryClientProvider client={qc}>
        <WagmiProvider config={wagmiConfig}>
          <RainbowKitProvider modalSize="compact">
            <MiniPayBridge />
            <WelcomeGasBridge />
            <Suspense>
              <LangProvider>{children}</LangProvider>
            </Suspense>
          </RainbowKitProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
