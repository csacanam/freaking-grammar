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

  // Diagnostic #2: wrap Array.prototype.filter so that any callback which
  // throws dumps the offending item before the error propagates. Privy's
  // crash (`e.icon?.replace is not a function`) happens inside an
  // Array.filter, and we need to see exactly what item makes `.icon` a
  // non-string. Only installs once, in dev tools users can then inspect the
  // logged payload to find the culprit (custom token? linked account? a
  // wallet the dashboard registered?).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { __fgFilterPatched?: boolean };
    if (w.__fgFilterPatched) return;
    w.__fgFilterPatched = true;
    const orig = Array.prototype.filter;
    Array.prototype.filter = function <T>(
      this: T[],
      fn: (v: T, i: number, a: T[]) => boolean,
      ctx?: unknown,
    ): T[] {
      return orig.call(
        this,
        function (this: unknown, v: T, i: number, a: T[]) {
          try {
            return fn.call(this, v, i, a);
          } catch (err) {
            console.log("[FILTER CRASH]", {
              item: v,
              index: i,
              arrayLength: a.length,
              error: (err as Error).message,
              itemKeys:
                v && typeof v === "object" ? Object.keys(v) : undefined,
              iconType: (v as { icon?: unknown })?.icon
                ? typeof (v as { icon?: unknown }).icon
                : "missing",
              iconValue: (v as { icon?: unknown })?.icon,
            });
            throw err;
          }
        },
        ctx,
      ) as T[];
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
