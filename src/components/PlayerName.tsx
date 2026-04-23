"use client";

import { useEnsName } from "wagmi";
import { mainnet } from "viem/chains";
import { shortAddr } from "@/lib/format";

// Shows an ENS name if the address has one (resolved on mainnet), else falls
// back to the truncated hex address. Used in leaderboards and profile headers.
// ENS and hex share the same mono styling so leaderboard rows read evenly —
// the display font made ENS entries pop out like headings next to plain hex.
export function PlayerName({ address }: { address: string }) {
  const { data: ensName } = useEnsName({
    address: address as `0x${string}`,
    chainId: mainnet.id,
  });
  return (
    <span className="font-mono">{ensName ?? shortAddr(address)}</span>
  );
}
