// Server-side: turns a settled pot row's frozen draw columns into the
// player-facing "how was this winner picked" proof shown in History.
//
// Players saw the same wallet win several days in a row and couldn't tell
// why — the audit data existed (GET /api/draw) but only as raw JSON. This
// shapes the same inputs into what the UI walks through step by step:
// the boundary block (number, time, hash), the seed derived from it, the
// winning ticket number, and every run's ticket range so anyone can see
// which range the winning number landed in.
//
// Ticket numbers are 1-based for display (index + 1); the math is still
// seed % total over the run-id-ordered expansion, exactly as roll-day and
// /api/draw compute it.

import type { Hex } from "viem";
import { celoClient } from "@/lib/onchain";
import { pickWinnerIndex } from "@/lib/draw";

export type DrawProofEntry = {
  player: string;
  score: number;
  tickets: number;
  from: number; // first ticket number (1-based, inclusive)
  to: number; // last ticket number (1-based, inclusive)
};

export type DrawProof = {
  gameId: number;
  block: number | null;
  blockTimeIso: string | null;
  blockHash: string | null;
  seed: string;
  totalTickets: number;
  players: number;
  winningTicket: number; // 1-based
  winnerTickets: number;
  entries: DrawProofEntry[];
  payoutTx: string | null;
};

export type DrawColumns = {
  draw_seed: string | null;
  draw_block: number | string | null;
  draw_tickets: number | null;
  draw_entries: unknown;
  rolled_tx: string | null;
  winner: string | null;
};

type StoredEntry = {
  runId: string;
  player: string;
  score: number;
  tickets: number;
};

// Blocks are immutable, so a per-instance memo is safe forever. All three
// pots of a day share one boundary block, so History's parallel fetches
// mostly hit this after the first.
const blockMemo = new Map<string, Promise<{ ts: number; hash: string } | null>>();

function blockInfo(num: number): Promise<{ ts: number; hash: string } | null> {
  const key = String(num);
  let p = blockMemo.get(key);
  if (!p) {
    p = celoClient
      .getBlock({ blockNumber: BigInt(num) })
      .then((b) => (b.hash ? { ts: Number(b.timestamp), hash: b.hash } : null))
      .catch(() => {
        blockMemo.delete(key); // RPC hiccup — retry on the next request
        return null;
      });
    blockMemo.set(key, p);
  }
  return p;
}

// Null = not a draw day (legacy top-score, or zero tickets → carried over).
export async function buildDrawProof(
  row: DrawColumns,
  gameId: number,
): Promise<DrawProof | null> {
  if (!row.draw_seed || !row.draw_tickets) return null;

  const stored = ((row.draw_entries ?? []) as StoredEntry[])
    .slice()
    .sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));

  let next = 1;
  const entries: DrawProofEntry[] = stored.map((e) => {
    const from = next;
    next += e.tickets;
    return {
      player: e.player,
      score: e.score,
      tickets: e.tickets,
      from,
      to: next - 1,
    };
  });
  const total = next - 1;
  if (total <= 0) return null;

  const winningTicket = pickWinnerIndex(row.draw_seed as Hex, total) + 1;
  const winner = row.winner?.toLowerCase() ?? null;
  const winnerTickets = entries
    .filter((e) => e.player === winner)
    .reduce((s, e) => s + e.tickets, 0);

  const block = row.draw_block == null ? null : Number(row.draw_block);
  const info = block == null ? null : await blockInfo(block);

  return {
    gameId,
    block,
    blockTimeIso: info ? new Date(info.ts * 1000).toISOString() : null,
    blockHash: info?.hash ?? null,
    seed: row.draw_seed,
    totalTickets: total,
    players: new Set(entries.map((e) => e.player)).size,
    winningTicket,
    winnerTickets,
    entries,
    payoutTx: row.rolled_tx,
  };
}
