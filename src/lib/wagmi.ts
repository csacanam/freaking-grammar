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

// RainbowKit handles the connect modal: EIP-6963 detection for installed
// desktop wallets + WalletConnect-driven deep-links for mobile wallets (Rabby,
// MetaMask app, Coinbase Wallet, Trust, Rainbow…). farcasterMiniApp is added
// as an extra wagmi connector so the app auto-connects inside Warpcast / Base
// App without appearing in the user-facing picker. MiniPay auto-connect is
// handled separately in src/lib/minipay.ts. Mainnet is read-only for ENS.
export const CELO_RPC_URL =
  process.env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo.org";
export const MAINNET_RPC_URL =
  process.env.NEXT_PUBLIC_MAINNET_RPC_URL ||
  "https://ethereum-rpc.publicnode.com";

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
  ssr: true,
});

export const ACTIVE_CHAIN = celo;

export const POT_ADDRESS = (process.env.NEXT_PUBLIC_FREAKING_POT_CELO ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

// Stablecoin + decimals per chain. Entry fee is 0.10 USDT = 100000 (6 decimals).
export const STABLECOIN = {
  [celo.id]: {
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as `0x${string}`, // USDT on Celo
    symbol: "USDT",
    decimals: 6,
  },
  [base.id]: {
    address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2" as `0x${string}`, // USDT on Base
    symbol: "USDT",
    decimals: 6,
  },
} as const;

export const ENTRY_FEE_UNITS = 100_000n; // 0.10 USDT in 6-decimal units
