"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { wagmiConfig } from "./wagmi";
import { LangProvider } from "./lang-provider";
import { useMiniPayAutoConnect } from "./minipay";

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

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider modalSize="compact">
          <MiniPayBridge />
          <Suspense>
            <LangProvider>{children}</LangProvider>
          </Suspense>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
