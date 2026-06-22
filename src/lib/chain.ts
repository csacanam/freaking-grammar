// Server-safe chain constants. Keep this file free of client-only imports
// (e.g. RainbowKit) so that API routes, crons, and static renderers like
// opengraph-image can import it without pulling in client bundles.

import { celo, base } from "viem/chains";
import { fallback, http, type Transport } from "viem";

const FORNO_RPC = "https://forno.celo.org";
// dRPC public Celo endpoint — free, no auth, internally load-balanced
// across multiple node providers. Used as a third fallback so that a
// simultaneous Alchemy + Forno hiccup still keeps us serving.
const DRPC_RPC = "https://celo.drpc.org";

export const CELO_RPC_URL =
  process.env.NEXT_PUBLIC_CELO_RPC_URL || FORNO_RPC;
export const MAINNET_RPC_URL =
  process.env.NEXT_PUBLIC_MAINNET_RPC_URL ||
  "https://ethereum-rpc.publicnode.com";

export const ACTIVE_CHAIN = celo;

export const POT_ADDRESS = (process.env.NEXT_PUBLIC_FREAKING_POT_CELO ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

// Stablecoin + decimals per chain. Entry fee is 0.10 USDT = 100000 (6 decimals).
//
// `feeCurrency` (Celo only) is the CIP-64 adapter address — NOT the token
// address. Passing the token address fails on chain. USDT/USDC are 6-decimal,
// so they go through adapter contracts that normalize to 18 decimals before
// the validator can compute gas. Pulled from celopedia builder-guide
// "Allowed Fee Currencies (Mainnet)". MiniPay uses this to pay gas in USDT
// instead of CELO so a user without CELO can still send transactions.
export const STABLECOIN = {
  [celo.id]: {
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as `0x${string}`, // USDT on Celo
    feeCurrency: "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72" as `0x${string}`,
    symbol: "USDT",
    decimals: 6,
  },
  [base.id]: {
    address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2" as `0x${string}`, // USDT on Base
    feeCurrency: undefined,
    symbol: "USDT",
    decimals: 6,
  },
} as const;

export const ENTRY_FEE_UNITS = 100_000n; // 0.10 USDT in 6-decimal units

// Use this transport for every viem client talking to Celo (PublicClient
// AND WalletClient). When NEXT_PUBLIC_CELO_RPC_URL is set (typically
// Alchemy), viem tries it first and falls back to Forno on ANY error —
// including the HTTP 429 "Monthly capacity limit" page Alchemy returns
// when its free tier runs out. dRPC sits in third position as a final
// safety net (free public endpoint, internally load-balanced) so a
// rare Alchemy + Forno simultaneous hiccup doesn't brick on-chain reads.
// If the primary env var isn't configured we still get Forno + dRPC.
export const CELO_TRANSPORT: Transport =
  process.env.NEXT_PUBLIC_CELO_RPC_URL &&
  process.env.NEXT_PUBLIC_CELO_RPC_URL !== FORNO_RPC
    ? fallback([http(CELO_RPC_URL), http(FORNO_RPC), http(DRPC_RPC)])
    : fallback([http(FORNO_RPC), http(DRPC_RPC)]);
