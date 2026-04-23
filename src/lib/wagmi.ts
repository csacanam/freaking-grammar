"use client";

import { http } from "viem";
import { celo, base, mainnet } from "viem/chains";
import { createConfig } from "@privy-io/wagmi";
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

// Client-only. Uses @privy-io/wagmi's createConfig so the Privy embedded
// wallet integrates as a first-class wagmi connector when a user signs in
// with email. RainbowKit still powers the "use your own wallet" path, and
// farcasterMiniApp keeps auto-connecting inside Warpcast / Base App.
// MiniPay auto-connect lives separately in src/lib/minipay.ts.

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
