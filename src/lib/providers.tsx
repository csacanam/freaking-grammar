"use client";

import { WagmiProvider } from "@privy-io/wagmi";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { celo, base, mainnet } from "viem/chains";
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

  // Diagnostic: dump every EIP-6963 provider announcement so we can identify
  // the one whose non-string icon makes Privy's internal `.icon.replace(...)`
  // crash. Logs only — if you see a wallet here with `icon_type !== 'string'`
  // that's our culprit.
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

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        defaultChain: celo,
        supportedChains: [celo, base, mainnet],
        appearance: {
          theme: "light",
          accentColor: "#68c3a0",
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
