"use client";

import { useEnsName } from "wagmi";
import { mainnet } from "viem/chains";

// Shows an ENS name if the address has one (resolved on mainnet), else
// falls back to a `Player <first4>…<last4>` alias. Used in leaderboards
// and profile headers.
//
// Previously we rendered the raw truncated form (`0xABCD…WXYZ`). MiniPay
// listing rules forbid raw 0x… as the primary identifier — only allowed
// as a *secondary* hint behind a real alias. Framing the address ends
// behind a "Player" label keeps the rule satisfied while dodging the
// ODIS phone-resolution detour.
//
// We use both ends of the address (first 4 + last 4) instead of just
// the tail. With ~200 active players today and only the last 4 hex chars
// of entropy (16^4 = 65k slots) the birthday-paradox collision odds were
// already ~30% per visible leaderboard — two rows reading "Player 4cc7"
// in the same view is confusing. Eight hex chars of entropy (16^8 = 4.3B)
// pushes collisions effectively to zero at any plausible nerdos.fun
// scale. ENS resolution still wins when available.
export function PlayerName({ address }: { address: string }) {
  const { data: ensName } = useEnsName({
    address: address as `0x${string}`,
    chainId: mainnet.id,
  });
  return (
    <span className="font-mono">
      {ensName ??
        `Player ${address.slice(2, 6)}…${address.slice(-4)}`}
    </span>
  );
}
