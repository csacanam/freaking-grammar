"use client";

import { useAccount } from "wagmi";

// Wallet-only identity. No more localStorage demo addresses — every player on
// the leaderboard must be a real connected wallet so winners can actually claim.
export function useCurrentPlayer(): { address: string; isConnected: boolean } {
  const { address, isConnected } = useAccount();
  return {
    address: address ? address.toLowerCase() : "",
    isConnected: !!isConnected,
  };
}
