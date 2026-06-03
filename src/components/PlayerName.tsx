"use client";

import { useEnsName } from "wagmi";
import { mainnet } from "viem/chains";

// Shows an ENS name if the address has one (resolved on mainnet), else
// falls back to a "Player <last4>" alias. Used in leaderboards and
// profile headers.
//
// Previously we rendered the raw truncated form (`0xABCD…WXYZ`). MiniPay
// listing rules forbid raw 0x… as the primary identifier — only allowed
// as a *secondary* hint behind a real alias. Framing the address tail
// behind a "Player" label keeps every row uniquely identifiable while
// satisfying the rule without an ODIS phone-resolution detour. ENS
// resolution still wins when available.
export function PlayerName({ address }: { address: string }) {
  const { data: ensName } = useEnsName({
    address: address as `0x${string}`,
    chainId: mainnet.id,
  });
  return (
    <span className="font-mono">
      {ensName ?? `Player ${address.slice(-4)}`}
    </span>
  );
}
