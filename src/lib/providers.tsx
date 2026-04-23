"use client";

import { WagmiProvider } from "wagmi";
import { PrivyProvider, useWallets } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount, useConnect, useConnectors } from "wagmi";
import { celo, base, mainnet } from "viem/chains";
import { CELO_RPC_URL, MAINNET_RPC_URL } from "./chain";
import { wagmiConfig } from "./wagmi";

// Privy uses `chain.rpcUrls.default.http[0]` when the embedded wallet
// sends transactions. If we hand it plain `celo` from viem/chains, it
// talks to Forno (the public default) and we've seen "RPC unknown
// error" under load there. Override with our Alchemy URL — same one
// wagmi's transport uses — so embedded-wallet plays never hit a
// flakey public endpoint.
const CELO_WITH_RPC = {
  ...celo,
  rpcUrls: {
    ...celo.rpcUrls,
    default: { http: [CELO_RPC_URL] },
  },
};
const MAINNET_WITH_RPC = {
  ...mainnet,
  rpcUrls: {
    ...mainnet.rpcUrls,
    default: { http: [MAINNET_RPC_URL] },
  },
};
import { LangProvider } from "./lang-provider";
import { useMiniPayAutoConnect } from "./minipay";
import { WelcomeGasBridge } from "@/components/WelcomeGasBridge";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";

// Must live inside WagmiProvider so the wagmi hooks have a client.
function MiniPayBridge() {
  useMiniPayAutoConnect();
  return null;
}

// Bridges the Privy embedded wallet into wagmi WITHOUT using
// @privy-io/wagmi — that package's WagmiProvider runs useSyncPrivyWallets
// which calls `config._internal.connectors.setState(newArray)` on every
// tick, blowing away every RainbowKit connector we defined so the "Use
// your own wallet" modal ends up empty. Instead we:
//   1. Wait for Privy to create the embedded wallet (useWallets).
//   2. Announce it via EIP-6963; wagmi's multiInjectedProviderDiscovery
//      picks it up and registers it as an injected connector alongside
//      everything else.
//   3. Auto-connect once the connector shows up in useConnectors().
function PrivyEmbeddedBridge() {
  const { wallets, ready } = useWallets();
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const { address } = useAccount();
  const announcedFor = useRef<string | null>(null);

  // Step 1 + 2: announce the provider via EIP-6963 so wagmi discovers it.
  useEffect(() => {
    if (!ready) return;
    if (typeof window === "undefined") return;
    const privyWallet = wallets.find((w) => w.walletClientType === "privy");
    if (!privyWallet) return;
    if (announcedFor.current === privyWallet.address) return;

    (async () => {
      try {
        const provider = await privyWallet.getEthereumProvider();
        const info = Object.freeze({
          uuid: `privy-${privyWallet.address}`,
          rdns: "io.privy.wallet",
          name: "Privy Wallet",
          icon: "",
        });
        const detail = Object.freeze({ info, provider });

        // Respond to any future request-provider events.
        window.addEventListener("eip6963:requestProvider", () => {
          window.dispatchEvent(
            new CustomEvent("eip6963:announceProvider", { detail }),
          );
        });

        // Proactively announce so wagmi registers it right now.
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", { detail }),
        );

        announcedFor.current = privyWallet.address;
      } catch (e) {
        console.error("PrivyEmbeddedBridge: announce failed", e);
      }
    })();
  }, [wallets, ready]);

  // Step 3: once wagmi sees the Privy connector, auto-connect.
  // The `wallets` check matters: after a user logs out of Privy, wagmi
  // still has the EIP-6963-registered connector cached, and `disconnect()`
  // would otherwise immediately get undone by this effect. Skipping when
  // Privy has no wallets keeps disconnect sticky.
  useEffect(() => {
    if (address) return;
    const privyWallet = wallets.find((w) => w.walletClientType === "privy");
    if (!privyWallet) return;
    const privyConnector = connectors.find((c) => c.id === "io.privy.wallet");
    if (!privyConnector) return;
    connectAsync({ connector: privyConnector }).catch((e) => {
      console.error("PrivyEmbeddedBridge: connect failed", e);
    });
  }, [connectors, address, connectAsync, wallets]);

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
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        // defaultChain must match wagmi's primary chain so the embedded
        // wallet is provisioned on Celo, not Ethereum.
        defaultChain: CELO_WITH_RPC,
        supportedChains: [CELO_WITH_RPC, base, MAINNET_WITH_RPC],
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
            <PrivyEmbeddedBridge />
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
