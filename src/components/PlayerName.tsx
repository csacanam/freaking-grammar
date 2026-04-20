"use client";

import { useEnsName } from "wagmi";
import { mainnet } from "viem/chains";
import { shortAddr } from "@/lib/format";

// Shows an ENS name if the address has one (resolved on mainnet), else falls
// back to the truncated hex address. Used in leaderboards and profile headers.
export function PlayerName({ address }: { address: string }) {
  const { data: ensName } = useEnsName({
    address: address as `0x${string}`,
    chainId: mainnet.id,
  });
  return ensName ? (
    <span className="font-display">{ensName}</span>
  ) : (
    <span className="font-mono">{shortAddr(address)}</span>
  );
}
