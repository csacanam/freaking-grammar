import {
  createPublicClient,
  http,
  parseEventLogs,
  type Abi,
  type Hex,
} from "viem";
import { celo } from "viem/chains";
import { CELO_RPC_URL, POT_ADDRESS } from "./chain";
import FreakingPotArtifact from "./contracts/FreakingPot.json";

export const FREAKING_POT_ABI = FreakingPotArtifact.abi as Abi;

export const celoClient = createPublicClient({
  chain: celo,
  transport: http(CELO_RPC_URL),
});

type PlayedArgs = {
  gameId: bigint;
  day: bigint;
  player: `0x${string}`;
  wasFree: boolean;
  potAfter: bigint;
};

export type VerifyResult =
  | { valid: true; wasFree: boolean; potAfter: bigint; dayNumber: bigint }
  | { valid: false; reason: string };

/// Confirms the tx actually paid `entryFee` into `play(gameId)` from `player`
/// within today's UTC window. Returns the resulting pot size from the event
/// so the caller can mirror it to the DB in the same write.
export async function verifyPaymentTx(
  txHash: string,
  player: string,
  gameId: number,
): Promise<VerifyResult> {
  let receipt;
  try {
    receipt = await celoClient.getTransactionReceipt({
      hash: txHash as Hex,
    });
  } catch {
    return { valid: false, reason: "tx-not-found" };
  }
  if (receipt.status !== "success") {
    return { valid: false, reason: "tx-failed" };
  }
  if (!receipt.to || receipt.to.toLowerCase() !== POT_ADDRESS.toLowerCase()) {
    return { valid: false, reason: "wrong-contract" };
  }
  if (receipt.from.toLowerCase() !== player.toLowerCase()) {
    return { valid: false, reason: "wrong-signer" };
  }

  const block = await celoClient.getBlock({ blockHash: receipt.blockHash });
  const blockTime = Number(block.timestamp);
  const now = new Date();
  const dayStart = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000,
  );
  const dayEnd = dayStart + 86_400;
  if (blockTime < dayStart || blockTime >= dayEnd) {
    return { valid: false, reason: "tx-not-today" };
  }

  const events = parseEventLogs({
    abi: FREAKING_POT_ABI,
    logs: receipt.logs,
    eventName: "Played",
  });

  const played = events.find((e) => {
    const a = e.args as unknown as PlayedArgs | undefined;
    return a && a.player.toLowerCase() === player.toLowerCase();
  });
  if (!played) return { valid: false, reason: "no-played-event" };

  const args = played.args as unknown as PlayedArgs;
  if (Number(args.gameId) !== gameId) {
    return { valid: false, reason: "wrong-gameId" };
  }

  return {
    valid: true,
    wasFree: args.wasFree,
    potAfter: args.potAfter,
    dayNumber: args.day,
  };
}

/// On-chain truth for "has this player still got today's free play".
export async function readHasFreePlayToday(
  gameId: number,
  player: `0x${string}`,
): Promise<boolean> {
  return (await celoClient.readContract({
    address: POT_ADDRESS,
    abi: FREAKING_POT_ABI,
    functionName: "hasFreePlayToday",
    args: [BigInt(gameId), player],
  })) as boolean;
}

/// Reads current pot amount from the contract for (gameId, dayNumber).
export async function readPotAmount(
  gameId: number,
  dayNumber: number | bigint,
): Promise<bigint> {
  const result = (await celoClient.readContract({
    address: POT_ADDRESS,
    abi: FREAKING_POT_ABI,
    functionName: "viewPot",
    args: [BigInt(gameId), BigInt(dayNumber)],
  })) as bigint;
  return result;
}

/// For a set of (gameId, day) candidates, returns the subset still unclaimed
/// on-chain. Source of truth is `claimed[gameId][day]` — DB rows can lag
/// because no indexer listens for Claimed events.
export async function readClaimedFlags(
  gameId: number,
  days: number[],
): Promise<Record<number, boolean>> {
  const results = (await Promise.all(
    days.map((d) =>
      celoClient.readContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "claimed",
        args: [BigInt(gameId), BigInt(d)],
      }),
    ),
  )) as boolean[];
  const out: Record<number, boolean> = {};
  days.forEach((d, i) => {
    out[d] = results[i];
  });
  return out;
}

/// Treasury balance + configured daily seed for a game. Used by the runway
/// alert cron to tell the operator how many more days of pots are funded.
export async function readTreasuryState(
  gameId: number,
): Promise<{ treasury: bigint; dailySeed: bigint }> {
  const [treasury, dailySeed] = (await Promise.all([
    celoClient.readContract({
      address: POT_ADDRESS,
      abi: FREAKING_POT_ABI,
      functionName: "treasury",
      args: [BigInt(gameId)],
    }),
    celoClient.readContract({
      address: POT_ADDRESS,
      abi: FREAKING_POT_ABI,
      functionName: "dailySeed",
      args: [BigInt(gameId)],
    }),
  ])) as [bigint, bigint];
  return { treasury, dailySeed };
}
