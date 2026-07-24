import { toDataSuffix } from "@celo/attribution-tags";

// ERC-8021 attribution suffix for Celo. A few bytes appended to the END of a
// transaction's calldata so Celo can credit the on-chain activity this app
// drives. The EVM discards trailing calldata bytes, so the suffix is invisible
// to the contract being called — it never changes what a tx does. It costs a
// handful of gas (16 gas per non-zero byte, ~31 bytes → ~500 gas).
//
// The code itself is NOT in this repo: the repo is public and Celo asks that
// the tag→app mapping stay private. It lives in
// NEXT_PUBLIC_CELO_ATTRIBUTION_TAG (Vercel env + .env.local). It has to be
// NEXT_PUBLIC_ because user transactions are signed in the browser, so the
// value ends up in the client bundle — and on-chain in every tagged tx —
// either way. The env var buys us "not in the public git history", not
// secrecy.
//
// Docs: https://github.com/celo-org/attribution-tags (BUILDERS.md)
const CODE = process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG;

// toDataSuffix throws on a malformed code (uppercase, spaces, >32 bytes).
// Attribution is telemetry — never let a bad env value take down the pay,
// claim or roll-day paths. Unset or invalid → undefined → viem treats
// `dataSuffix: undefined` as a no-op and the tx goes out untagged.
function encode(): `0x${string}` | undefined {
  if (!CODE) return undefined;
  try {
    return toDataSuffix(CODE);
  } catch {
    return undefined;
  }
}

export const ATTRIBUTION_SUFFIX = encode();

// Spread into viem/wagmi writeContract & sendTransaction args on paths that
// don't already go through useTxOverrides() (which folds this in for the
// user-facing wallet flows).
export const ATTRIBUTION_TX: { dataSuffix?: `0x${string}` } =
  ATTRIBUTION_SUFFIX ? { dataSuffix: ATTRIBUTION_SUFFIX } : {};
