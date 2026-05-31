"use client";

import { http } from "viem";
import { celo, base, mainnet } from "viem/chains";
// CELO_TRANSPORT wraps the Alchemy URL (or whatever is in
// NEXT_PUBLIC_CELO_RPC_URL) with a Forno fallback so wagmi reads
// keep working even when the primary provider 429s.
// IMPORTANT: import createConfig from `wagmi`, NOT `@privy-io/wagmi`.
// @privy-io/wagmi's createConfig drops every non-mock connector and
// disables EIP-6963 discovery; its WagmiProvider then runs
// useSyncPrivyWallets which nukes connector state whenever Privy has no
// wallets. Both are incompatible with our RainbowKit picker. We get the
// Privy embedded wallet via an EIP-6963 bridge in providers.tsx instead.
import { createConfig } from "wagmi";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { CELO_TRANSPORT, MAINNET_RPC_URL } from "./chain";

// Client-only. RainbowKit handles the connect modal. EIP-6963 detection
// for installed desktop wallets + WalletConnect deep-links for mobile apps
// (Rabby, MetaMask, Coinbase, Trust, Rainbow…). farcasterMiniApp is
// prepended for auto-connect inside Warpcast / Base App without appearing
// in the picker. MiniPay auto-connect lives in src/lib/minipay.ts. Privy
// embedded wallets announce themselves via EIP-6963 from
// PrivyEmbeddedBridge in providers.tsx, so they also surface here without
// special-casing.

const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

const rainbowKitConnectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [
        metaMaskWallet,
        rabbyWallet,
        coinbaseWallet,
        rainbowWallet,
        trustWallet,
        walletConnectWallet,
        injectedWallet,
      ],
    },
  ],
  {
    appName: "nerdos.fun",
    projectId: WALLETCONNECT_PROJECT_ID,
  },
);

export const wagmiConfig = createConfig({
  chains: [celo, base, mainnet],
  transports: {
    [celo.id]: CELO_TRANSPORT,
    [base.id]: http(),
    [mainnet.id]: http(MAINNET_RPC_URL),
  },
  connectors: [farcasterMiniApp(), ...rainbowKitConnectors],
  ssr: true,
});
