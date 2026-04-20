// Server-safe chain constants. Keep this file free of client-only imports
// (e.g. RainbowKit) so that API routes, crons, and static renderers like
// opengraph-image can import it without pulling in client bundles.

import { celo, base } from "viem/chains";

export const CELO_RPC_URL =
  process.env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo.org";
export const MAINNET_RPC_URL =
  process.env.NEXT_PUBLIC_MAINNET_RPC_URL ||
  "https://ethereum-rpc.publicnode.com";

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
