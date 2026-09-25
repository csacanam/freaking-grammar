// Daily pot draw — the winner-selection policy that replaced top-score-wins
// on DRAW_START_DAY (2026-09-21).
//
// Why: under top-score, the grammar winner was whoever cleared the full
// 234-question bank (~27 wallets) and the math winner a bot pacing at 109.
// 43% of all prize money went to wallets later flagged as bots, 87-97% of
// recent daily wins were FREE runs, and only 0.7% of players ever won
// anything — payers funded a pot they couldn't win, which is why paid
// conversion decayed. A draw makes every ticket equal: a bot's perfect
// score buys it nothing, and its $0.10 entry is just revenue.
//
// Rules (constants + calibration rationale in src/lib/draw-config.ts):
//   - Each PAID run that finished with score > 0 earns 1 ticket for playing
//     plus 1 per TICKET_STEP points, capped at MAX_TICKETS_PER_RUN (3).
//     Skill multiplies your odds — bounded, so a perfect (bot) run earns
//     what a good human run earns and score can never *decide* the pot.
//   - No cap on runs per day: every paid run adds tickets, so odds scale
//     with spend. More runs = revenue and pot growth, from bots included;
//     the parimutuel pool self-limits (buying more dilutes your own EV).
//   - Only ops-confirmed fraud (bot_wallets reason='manual') is excluded.
//     Heuristic score/timing flags no longer touch the draw (2026-09-24):
//     a flagged payer's tickets stay in, since score is capped at 3 tickets
//     per run and dropping paid runs contradicted the public ticket list.
//   - Zero tickets → no winner → the contract carries the pot forward and
//     skips the treasury seed (rollDay's ghost-day branch), so a quiet day
//     costs nothing and the pot waits for its first entrant.
//
// Verifiability: the seed is the hash of the first Celo block at/after the
// UTC day boundary — produced by the chain, outside anyone's control, and
// only known after entries close. Per game: keccak256(blockHash ‖ gameId).
// Winner = entries[seed % n] over entries sorted by run id. Anyone can
// recompute the draw from public data; the seed and block are stored on the
// pot row (draw_seed / draw_block / draw_tickets).

import { encodePacked, hexToBigInt, keccak256, type Hex } from "viem";

import { ticketsForScore } from "@/lib/draw-config";

// Minimal structural view of a viem public client. The Celo client's
// getBlock returns CIP-64 transaction unions that don't unify with the
// generic PublicClient type, so we only ask for the three fields the
// binary search actually reads.
type BlockSource = {
  getBlock(args?: { blockNumber?: bigint }): Promise<{
    number: bigint | null;
    timestamp: bigint;
    hash: Hex | null;
  }>;
};

// Settlements for days >= this use the draw; earlier days settle with the
// legacy top-score walk. Prevents applying the new rule retroactively to
// runs played under the old one.
export const DRAW_START_DAY = process.env.DRAW_START_DAY || "2026-09-21";

export type TicketEntry = {
  runId: string;
  player: string; // lower-case
  score: number;
};

// One entry per ticket: every paid run contributes ticketsForScore()
// consecutive entries, in run id order — uuids are stable and public — so
// the whole expansion is reproducible from raw data regardless of input
// order.
export function buildTicketEntries(
  rows: Array<{ id: string; player: string; score: number }>,
  gameId: number,
): TicketEntry[] {
  const sorted = [...rows].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const entries: TicketEntry[] = [];
  for (const r of sorted) {
    const player = r.player.toLowerCase();
    const tickets = ticketsForScore(r.score, gameId);
    for (let k = 0; k < tickets; k++) {
      entries.push({ runId: r.id, player, score: r.score });
    }
  }
  return entries;
}

export function drawSeedForGame(blockHash: Hex, gameId: number): Hex {
  return keccak256(encodePacked(["bytes32", "uint256"], [blockHash, BigInt(gameId)]));
}

export function pickWinnerIndex(seed: Hex, ticketCount: number): number {
  if (ticketCount <= 0) throw new Error("no tickets");
  return Number(hexToBigInt(seed) % BigInt(ticketCount));
}

// First block with timestamp >= the UTC midnight that OPENS `dayUtc`'s
// successor — i.e. the moment the day being settled closed. Binary search;
// Celo is ~1s/block so ~30 getBlock calls, well inside roll-day's budget.
export async function findBoundaryBlock(
  client: BlockSource,
  closedDayUtc: string,
): Promise<{ number: bigint; hash: Hex }> {
  const boundaryTs = BigInt(
    Math.floor(Date.parse(`${closedDayUtc}T00:00:00Z`) / 1000) + 86400,
  );
  const head = await client.getBlock();
  if (head.number == null) throw new Error("head block has no number");
  if (head.timestamp < boundaryTs) {
    throw new Error(
      `boundary ${boundaryTs} is in the future (head ts ${head.timestamp})`,
    );
  }
  let lo = 0n;
  let hi = head.number;
  // Seed the search with a ~1s/block linear estimate to cut iterations.
  const est = head.number - (head.timestamp - boundaryTs);
  if (est > 0n && est < hi) {
    const b = await client.getBlock({ blockNumber: est });
    if (b.timestamp < boundaryTs) lo = est;
    else hi = est;
  }
  // Invariant: block(lo).ts < boundary <= block(hi).ts
  while (lo + 1n < hi) {
    const mid = (lo + hi) / 2n;
    const b = await client.getBlock({ blockNumber: mid });
    if (b.timestamp < boundaryTs) lo = mid;
    else hi = mid;
  }
  const found = await client.getBlock({ blockNumber: hi });
  if (found.number == null || found.hash == null) {
    throw new Error(`boundary block ${hi} not finalized`);
  }
  return { number: found.number, hash: found.hash };
}

// Deterministic fallback seed for when the RPC can't serve the boundary
// block: hashes the closed day + game + the exact ordered ticket list.
// Still reproducible from public data, just not chain-sourced; roll-day
// logs loudly when it has to use this.
export function fallbackSeed(
  closedDayUtc: string,
  gameId: number,
  entries: TicketEntry[],
): Hex {
  const material = `${closedDayUtc}|${gameId}|${entries.map((e) => e.runId).join(",")}`;
  return keccak256(encodePacked(["string"], [material]));
}
