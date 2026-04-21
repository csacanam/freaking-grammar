"use client";

import { http } from "viem";
import { celo, base, mainnet } from "viem/chains";
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
import { CELO_RPC_URL, MAINNET_RPC_URL } from "./chain";

// Client-only: RainbowKit handles the connect modal. EIP-6963 detection for
// installed desktop wallets + WalletConnect-driven deep-links to mobile wallet
// apps (Rabby, MetaMask, Coinbase, Trust, Rainbow…). farcasterMiniApp is
// prepended as an extra wagmi connector so the app auto-connects inside
// Warpcast / Base App without appearing in the user-facing picker. MiniPay
// auto-connect is handled separately in src/lib/minipay.ts.

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
    appName: "Freaking Grammar",
    projectId: WALLETCONNECT_PROJECT_ID,
  },
);

export const wagmiConfig = createConfig({
  chains: [celo, base, mainnet],
  transports: {
    [celo.id]: http(CELO_RPC_URL),
    [base.id]: http(),
    [mainnet.id]: http(MAINNET_RPC_URL),
  },
  connectors: [farcasterMiniApp(), ...rainbowKitConnectors],
});
