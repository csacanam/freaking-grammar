import { http } from "viem";
import { celo, base, mainnet } from "viem/chains";
import { createConfig, injected } from "wagmi";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";

// Farcaster mini-app auto-connects inside Warpcast/Base App; `injected` handles
// MiniPay (Opera Mini on Celo) and regular browsers with a wallet extension.
// Mainnet is included read-only for ENS name resolution on leaderboards.
export const CELO_RPC_URL =
  process.env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo.org";
export const MAINNET_RPC_URL =
  process.env.NEXT_PUBLIC_MAINNET_RPC_URL ||
  "https://ethereum-rpc.publicnode.com";

export const wagmiConfig = createConfig({
  chains: [celo, base, mainnet],
  transports: {
    [celo.id]: http(CELO_RPC_URL),
    [base.id]: http(),
    [mainnet.id]: http(MAINNET_RPC_URL),
  },
  connectors: [farcasterMiniApp(), injected({ shimDisconnect: false })],
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
