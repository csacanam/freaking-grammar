"use client";

import { http } from "viem";
import { celo, base, mainnet } from "viem/chains";
import { createConfig } from "@privy-io/wagmi";
import type { CreateConnectorFn } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { CELO_RPC_URL, MAINNET_RPC_URL } from "./chain";

// Privy's SDK iterates every wagmi connector at render time and calls
// `icon.replace(...)` — assumes icons are string URLs. Some connectors
// (farcasterMiniApp especially) attach React components or SVG elements,
// which crashes the whole app. This helper strips any non-string icon
// before the connector reaches Privy, keeping the connector otherwise
// intact.
function withStringIcon(factory: CreateConnectorFn): CreateConnectorFn {
  return ((config) => {
    const c = factory(config) as unknown as Record<string, unknown>;
    if (c.icon !== undefined && typeof c.icon !== "string") {
      c.icon = undefined;
    }
    return c as unknown as ReturnType<CreateConnectorFn>;
  }) as CreateConnectorFn;
}

const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

export const wagmiConfig = createConfig({
  chains: [celo, base, mainnet],
  transports: {
    [celo.id]: http(CELO_RPC_URL),
    [base.id]: http(),
    [mainnet.id]: http(MAINNET_RPC_URL),
  },
  connectors: [
    withStringIcon(farcasterMiniApp()),
    withStringIcon(injected({ shimDisconnect: false })),
    withStringIcon(coinbaseWallet({ appName: "Freaking Grammar" })),
    ...(WALLETCONNECT_PROJECT_ID
      ? [withStringIcon(walletConnect({ projectId: WALLETCONNECT_PROJECT_ID }))]
      : []),
  ],
});
