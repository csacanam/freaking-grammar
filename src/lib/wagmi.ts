"use client";

import { http } from "viem";
import { celo, base, mainnet } from "viem/chains";
import { createConfig } from "@privy-io/wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { CELO_RPC_URL, MAINNET_RPC_URL } from "./chain";

// Client-only. Uses plain wagmi connectors (not RainbowKit's
// `connectorsForWallets`) because RainbowKit attaches React components as
// icons which crash Privy's internal `icon.replace(...)` at render time.
// We still keep the RainbowKit modal for the "Use your own wallet" flow —
// it just displays these plain connectors (MetaMask via injected, Coinbase,
// WalletConnect) with their default icons. Non-email users never hit Privy
// and therefore don't count toward its MAU quota.

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
    farcasterMiniApp(),
    injected({ shimDisconnect: false }),
    coinbaseWallet({ appName: "Freaking Grammar" }),
    ...(WALLETCONNECT_PROJECT_ID
      ? [walletConnect({ projectId: WALLETCONNECT_PROJECT_ID })]
      : []),
  ],
});
